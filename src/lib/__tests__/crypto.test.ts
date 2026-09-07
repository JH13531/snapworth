// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { argon2id } from 'hash-wasm'
import {
  encryptVault, decryptVault, generateRecoveryCode, validateRecoveryCode, isVaultBlob, isKeyFile,
  normalizeRecoveryCode,
  type ExportData, type VaultBlob,
} from '../crypto'

function sampleData(): ExportData {
  return {
    schema_version: 1,
    settings: {
      id: 'singleton', base_currency: 'CNY', theme: 'system', privacy_mode: false,
      invert_change_color: false, book_name: '测试账本', schema_version: 1,
      onboarded: true, updated_at: '2026-08-01T00:00:00Z',
    },
    accounts: [],
    snapshots: [],
    exchange_rates: [],
    monthly_reviews: [],
    tombstones: [],
  }
}

// ========== 辅助：构造一份「旧版」vault（恢复码走 HKDF），用于向后兼容测试 ==========
const HKDF_INFO_RECOVERY = new TextEncoder().encode('snapworth/recovery-code-kek/v1')

function toB64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

async function buildLegacyVault(data: ExportData, password: string, vaultId: string): Promise<{ blob: VaultBlob; recoveryCode: string }> {
  const recoveryCode = generateRecoveryCode()
  const normalized = normalizeRecoveryCode(recoveryCode)

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const mk = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])

  // 密码 KEK（Argon2id，和现在一样）
  const pwRaw = await argon2id({
    password, salt, parallelism: 4, iterations: 3, memorySize: 65536, hashLength: 32, outputType: 'binary',
  })
  const kekPw = await crypto.subtle.importKey('raw', pwRaw as BufferSource, { name: 'AES-KW' }, false, ['wrapKey', 'unwrapKey'])

  // 恢复码 KEK（旧版 HKDF）
  const hkdfKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(normalized) as BufferSource, { name: 'HKDF' }, false, ['deriveBits'],
  )
  const rcRaw = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: HKDF_INFO_RECOVERY },
    hkdfKey, 256,
  ))
  const kekRc = await crypto.subtle.importKey('raw', rcRaw as BufferSource, { name: 'AES-KW' }, false, ['wrapKey', 'unwrapKey'])

  const [wrappedPw, wrappedRc] = await Promise.all([
    crypto.subtle.wrapKey('raw', mk, kekPw, { name: 'AES-KW' }),
    crypto.subtle.wrapKey('raw', mk, kekRc, { name: 'AES-KW' }),
  ])

  const aad = new TextEncoder().encode(`snapworth-aad|1|${vaultId}|1`)
  const plaintext = new TextEncoder().encode(JSON.stringify(data))
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad as BufferSource }, mk, plaintext as BufferSource,
  ))
  const authTag = encrypted.slice(encrypted.length - 16)
  const ciphertext = encrypted.slice(0, encrypted.length - 16)

  return {
    recoveryCode,
    blob: {
      version: 1, vault_id: vaultId, revision: 1,
      kdf: { algo: 'argon2id', salt: toB64(salt), m: 65536, t: 3, p: 4 },
      encrypted_mk_by_password: toB64(new Uint8Array(wrappedPw)),
      encrypted_mk_by_recovery: toB64(new Uint8Array(wrappedRc)),
      iv: toB64(iv), auth_tag: toB64(authTag), aad_version: 1,
      ciphertext: toB64(ciphertext), updated_at: new Date().toISOString(),
      // 注意：故意不写 recovery_kdf，模拟旧版 vault
    },
  }
}

describe('vault encryption', () => {
  it('round-trips with password', async () => {
    const data = sampleData()
    const { blob } = await encryptVault(data, 'correct-horse', 'vault-123')
    expect(isVaultBlob(blob)).toBe(true)
    expect(blob.encrypted_mk_by_password).toBeTruthy()
    expect(blob.encrypted_mk_by_recovery).toBeTruthy()
    expect(blob.aad_version).toBe(1)

    const out = await decryptVault(blob, { password: 'correct-horse' })
    expect(out.schema_version).toBe(1)
    expect(out.settings.book_name).toBe('测试账本')
  })

  it('round-trips with recovery code', async () => {
    const data = sampleData()
    const { blob, recoveryCode } = await encryptVault(data, 'correct-horse', 'vault-123')
    expect(recoveryCode).toMatch(/^\d{5}-\d{5}-\d{5}-\d{5}-\d{5}-\d{5}$/)
    const out = await decryptVault(blob, { recoveryCode })
    expect(out.settings.book_name).toBe('测试账本')
  })

  it('new vaults use Argon2id for recovery-code KEK', async () => {
    const { blob } = await encryptVault(sampleData(), 'correct-horse', 'vault-123')
    expect(blob.recovery_kdf).toBeDefined()
    expect(blob.recovery_kdf?.algo).toBe('argon2id')
    expect(blob.recovery_kdf?.salt).toBeTruthy()
    expect(blob.recovery_kdf?.m).toBe(65536)
  })

  it('decrypts legacy vaults whose recovery code was derived via HKDF (backward compat)', async () => {
    const { blob, recoveryCode } = await buildLegacyVault(sampleData(), 'correct-horse', 'vault-legacy')
    expect(blob.recovery_kdf).toBeUndefined()
    const out = await decryptVault(blob, { recoveryCode })
    expect(out.settings.book_name).toBe('测试账本')
    // 同一份旧 vault 用密码也能解
    const out2 = await decryptVault(blob, { password: 'correct-horse' })
    expect(out2.settings.book_name).toBe('测试账本')
  })

  it('round-trips with key file', async () => {
    const data = sampleData()
    const { blob, keyFile } = await encryptVault(data, 'correct-horse', 'vault-123')
    expect(isKeyFile(keyFile)).toBe(true)
    expect(keyFile.vault_id).toBe('vault-123')
    const out = await decryptVault(blob, { keyFile })
    expect(out.settings.book_name).toBe('测试账本')
  })

  it('rejects wrong password', async () => {
    const { blob } = await encryptVault(sampleData(), 'correct-horse', 'v-1')
    await expect(decryptVault(blob, { password: 'wrong-password' })).rejects.toThrow()
  })

  it('rejects wrong recovery code', async () => {
    const { blob } = await encryptVault(sampleData(), 'correct-horse', 'v-1')
    const otherCode = generateRecoveryCode()
    await expect(decryptVault(blob, { recoveryCode: otherCode })).rejects.toThrow()
  })

  it('rejects key file from a different vault', async () => {
    const { blob } = await encryptVault(sampleData(), 'correct-horse', 'vault-A')
    const { keyFile } = await encryptVault(sampleData(), 'correct-horse', 'vault-B')
    await expect(decryptVault(blob, { keyFile })).rejects.toThrow(/vault_id 不一致/)
  })

  it('rejects tampered ciphertext (AAD/GCM integrity)', async () => {
    const { blob } = await encryptVault(sampleData(), 'correct-horse', 'v-1')
    const tampered = { ...blob, ciphertext: blob.ciphertext.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) }
    await expect(decryptVault(tampered, { password: 'correct-horse' })).rejects.toThrow()
  })

  it('rejects vault blob from a different vault_id (AAD binding)', async () => {
    const { blob, recoveryCode } = await encryptVault(sampleData(), 'correct-horse', 'vault-A')
    const swapped = { ...blob, vault_id: 'vault-B' }
    await expect(decryptVault(swapped, { password: 'correct-horse' })).rejects.toThrow()
    await expect(decryptVault(swapped, { recoveryCode })).rejects.toThrow()
  })
})

describe('recovery code', () => {
  it('generates valid 6-group 5-digit codes with check digit', () => {
    const code = generateRecoveryCode()
    expect(code).toMatch(/^\d{5}-\d{5}-\d{5}-\d{5}-\d{5}-\d{5}$/)
    const { valid } = validateRecoveryCode(code)
    expect(valid).toBe(true)
  })

  it('validates check digit correctly', () => {
    const code = generateRecoveryCode()
    const digits = code.replace(/-/g, '')
    const lastDigit = digits[digits.length - 1]
    const swapped = digits.slice(0, -1) + ((Number(lastDigit) + 1) % 10)
    const { valid, error } = validateRecoveryCode(swapped)
    expect(valid).toBe(false)
    expect(error).toContain('校验失败')
  })

  it('rejects too-short codes', () => {
    const { valid, error } = validateRecoveryCode('12345-67890')
    expect(valid).toBe(false)
    expect(error).toContain('应为 30 位')
  })

  it('accepts code with extra spaces/characters', () => {
    const code = generateRecoveryCode()
    const messy = code.replace(/-/g, ' ') + '  '
    const { valid } = validateRecoveryCode(messy)
    expect(valid).toBe(true)
  })
})
