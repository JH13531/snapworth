/**
 * Snapworth 加密 vault —— 信封加密（envelope encryption）。
 *
 * 密钥层级：
 *
 *   备份密码 ──Argon2id──▶ KEK_pw ──┐
 *                                    ├──AES-KW──▶ MK（随机 256 位）
 *   恢复码 ──HKDF-SHA256──▶ KEK_rc ──┘       │
 *   密钥文件（raw key）──────────────────────┘
 *                                            ▼
 *                                     AES-256-GCM
 *
 * - 数据真正由随机 MK 加密；密码、恢复码、密钥文件各自独立解锁。
 * - GCM 的 AAD 绑定 vault_id / revision / 格式版本，防止密文被跨账本替换或回滚。
 * - 忘记密码可用恢复码或密钥文件解锁；三者都丢失则数据不可恢复。
 */
import { argon2id } from 'hash-wasm'
import type { Account, SubAccount, Snapshot, ExchangeRate, Settings, Tombstone, MonthlyReview } from '@/types'

export interface ExportData {
  schema_version: number
  settings: Settings
  accounts: Account[]
  /** 子账户。旧版备份缺失此字段，导入时按账户兜底生成。 */
  sub_accounts?: SubAccount[]
  snapshots: Snapshot[]
  exchange_rates: ExchangeRate[]
  monthly_reviews: MonthlyReview[]
  tombstones: Tombstone[]
}

export interface VaultKdf {
  algo: 'argon2id'
  salt: string
  m: number
  t: number
  p: number
}

export interface VaultBlob {
  version: 1
  vault_id: string
  revision: number
  kdf: VaultKdf
  encrypted_mk_by_password: string
  encrypted_mk_by_recovery: string
  iv: string
  auth_tag: string
  aad_version: number
  ciphertext: string
  updated_at: string
  /**
   * 恢复码 KEK 派生方式。缺失 = 旧版 HKDF-SHA256（不抗离线暴力破解），
   * 存在 = Argon2id（与密码 KEK 同等强度）。新加密的 vault 一律使用 argon2id。
   */
  recovery_kdf?: { algo: 'argon2id'; salt: string; m: number; t: number; p: number }
}

export interface KeyFile {
  version: 1
  vault_id: string
  key: string
  created_at: string
}

export interface EncryptResult {
  blob: VaultBlob
  recoveryCode: string
  keyFile: KeyFile
}

export type UnlockCredentials =
  | { password: string; recoveryCode?: never; keyFile?: never }
  | { password?: never; recoveryCode: string; keyFile?: never }
  | { password?: never; recoveryCode?: never; keyFile: KeyFile }

const ARGON2_PARAMS = { m: 65536, t: 3, p: 4 }
const KEY_LEN = 32
const SALT_LEN = 16
const IV_LEN = 12
const AAD_VERSION = 1
const RECOVERY_CODE_GROUPS = 6
const RECOVERY_DIGITS_PER_GROUP = 5
const HKDF_INFO_RECOVERY = new TextEncoder().encode('snapworth/recovery-code-kek/v1')

// ========== 工具函数 ==========

function toB64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}

function randomBytes(len: number): Uint8Array {
  const arr = new Uint8Array(len)
  crypto.getRandomValues(arr)
  return arr
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

function encodeAad(vaultId: string, revision: number): Uint8Array {
  return new TextEncoder().encode(`snapworth-aad|${AAD_VERSION}|${vaultId}|${revision}`)
}

// ========== 恢复码 ==========

/**
 * 生成数字恢复码：30 位数字，6 组 × 5 位，连字符分隔。
 * 最后一位为校验位（前面 29 位数字之和 mod 10）。
 * 有效熵 ≈ 96 位（10^29 ≈ 2^96），对个人财务备份完全足够。
 */
export function generateRecoveryCode(): string {
  const totalDigits = RECOVERY_CODE_GROUPS * RECOVERY_DIGITS_PER_GROUP
  const digits = new Array<number>(totalDigits)

  // 用随机字节生成每一位数字
  const bytes = randomBytes(totalDigits)
  for (let i = 0; i < totalDigits - 1; i++) {
    digits[i] = bytes[i] % 10
  }

  // 最后一位 = 校验位
  let sum = 0
  for (let i = 0; i < totalDigits - 1; i++) sum += digits[i]
  digits[totalDigits - 1] = sum % 10

  // 分组
  const groups: string[] = []
  for (let g = 0; g < RECOVERY_CODE_GROUPS; g++) {
    const start = g * RECOVERY_DIGITS_PER_GROUP
    groups.push(digits.slice(start, start + RECOVERY_DIGITS_PER_GROUP).join(''))
  }
  return groups.join('-')
}

/** 规范化恢复码输入：移除非数字字符。 */
export function normalizeRecoveryCode(input: string): string {
  return input.replace(/\D/g, '')
}

/** 校验恢复码格式与校验位。 */
export function validateRecoveryCode(input: string): { valid: boolean; normalized: string; error?: string } {
  const normalized = normalizeRecoveryCode(input)
  const expectedLen = RECOVERY_CODE_GROUPS * RECOVERY_DIGITS_PER_GROUP

  if (normalized.length !== expectedLen) {
    return { valid: false, normalized, error: `恢复码应为 ${expectedLen} 位数字（当前 ${normalized.length} 位）` }
  }

  // 校验位验证
  let sum = 0
  for (let i = 0; i < expectedLen - 1; i++) {
    sum += Number(normalized[i])
  }
  const checkDigit = sum % 10
  if (checkDigit !== Number(normalized[expectedLen - 1])) {
    return { valid: false, normalized, error: '恢复码校验失败，请检查是否输错了数字' }
  }

  return { valid: true, normalized }
}

/** 恢复码经 HKDF-SHA256 派生 AES-KW KEK（旧版，仅用于兼容已有 vault）。 */
async function deriveKekFromRecoveryCodeLegacy(code: string): Promise<CryptoKey> {
  const { valid, normalized, error } = validateRecoveryCode(code)
  if (!valid) throw new Error(error ?? '恢复码无效')

  const normalizedBytes = new TextEncoder().encode(normalized)
  const hkdfKey = await crypto.subtle.importKey(
    'raw', normalizedBytes as BufferSource, { name: 'HKDF' }, false, ['deriveBits'],
  )
  const raw = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: HKDF_INFO_RECOVERY },
      hkdfKey,
      KEY_LEN * 8,
    ),
  )
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-KW' }, false, ['wrapKey', 'unwrapKey'])
}

/** 恢复码经 Argon2id 派生 AES-KW KEK（新版，与密码路径同等强度）。 */
async function deriveKekFromRecoveryCode(code: string, salt: Uint8Array): Promise<CryptoKey> {
  const { valid, normalized, error } = validateRecoveryCode(code)
  if (!valid) throw new Error(error ?? '恢复码无效')

  const raw = await argon2id({
    password: normalized,
    salt,
    parallelism: ARGON2_PARAMS.p,
    iterations: ARGON2_PARAMS.t,
    memorySize: ARGON2_PARAMS.m,
    hashLength: KEY_LEN,
    outputType: 'binary',
  })
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-KW' }, false, ['wrapKey', 'unwrapKey'])
}

// ========== 密钥文件 ==========

/** 从 MK 生成密钥文件对象。 */
async function makeKeyFile(mk: CryptoKey, vaultId: string): Promise<KeyFile> {
  const raw = await crypto.subtle.exportKey('raw', mk)
  return {
    version: 1,
    vault_id: vaultId,
    key: toB64(new Uint8Array(raw)),
    created_at: new Date().toISOString(),
  }
}

/** 从密钥文件导入 MK。 */
async function importKeyFromKeyFile(keyFile: KeyFile): Promise<CryptoKey> {
  if (keyFile.version !== 1) throw new Error('不支持的密钥文件版本')
  const raw = fromB64(keyFile.key)
  if (raw.length !== 32) throw new Error('密钥文件密钥长度不正确')
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['decrypt'])
}

/** 判断一个对象是否为密钥文件。 */
export function isKeyFile(data: unknown): data is KeyFile {
  return (
    !!data &&
    typeof data === 'object' &&
    (data as KeyFile).version === 1 &&
    typeof (data as KeyFile).key === 'string' &&
    typeof (data as KeyFile).vault_id === 'string'
  )
}

// ========== 密码 KEK ==========

/** Argon2id 派生 AES-KW 密钥加密密钥（KEK）。 */
async function deriveKekFromPassword(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const raw = await argon2id({
    password,
    salt,
    parallelism: ARGON2_PARAMS.p,
    iterations: ARGON2_PARAMS.t,
    memorySize: ARGON2_PARAMS.m,
    hashLength: KEY_LEN,
    outputType: 'binary',
  })
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-KW' }, false, ['wrapKey', 'unwrapKey'])
}

// ========== 加密 / 解密 ==========

/**
 * 加密数据生成 vault blob。
 * 每次生成随机 MK 与随机密码盐；同时生成恢复码与密钥文件作为等价解锁凭据。
 * vaultId 应为账本稳定标识（存于 Settings），revision 由同步层维护，文件导出固定为 1。
 */
export async function encryptVault(
  data: ExportData,
  password: string,
  vaultId: string,
  revision = 1,
): Promise<EncryptResult> {
  if (!password || password.length < 8) {
    throw new Error('密码至少 8 位')
  }

  const salt = randomBytes(SALT_LEN)
  const recoverySalt = randomBytes(SALT_LEN)
  const iv = randomBytes(IV_LEN)

  const mk = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
  const kekPw = await deriveKekFromPassword(password, salt)
  const recoveryCode = generateRecoveryCode()
  const kekRecovery = await deriveKekFromRecoveryCode(recoveryCode, recoverySalt)
  const keyFile = await makeKeyFile(mk, vaultId)

  const [wrappedByPw, wrappedByRecovery] = await Promise.all([
    crypto.subtle.wrapKey('raw', mk, kekPw, { name: 'AES-KW' }),
    crypto.subtle.wrapKey('raw', mk, kekRecovery, { name: 'AES-KW' }),
  ])

  const plaintext = new TextEncoder().encode(JSON.stringify(data))
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: encodeAad(vaultId, revision) as BufferSource },
      mk,
      plaintext as BufferSource,
    ),
  )
  const authTag = encrypted.slice(encrypted.length - 16)
  const ciphertext = encrypted.slice(0, encrypted.length - 16)

  return {
    blob: {
      version: 1,
      vault_id: vaultId,
      revision,
      kdf: {
        algo: 'argon2id',
        salt: toB64(salt),
        m: ARGON2_PARAMS.m,
        t: ARGON2_PARAMS.t,
        p: ARGON2_PARAMS.p,
      },
      encrypted_mk_by_password: toB64(new Uint8Array(wrappedByPw)),
      encrypted_mk_by_recovery: toB64(new Uint8Array(wrappedByRecovery)),
      iv: toB64(iv),
      auth_tag: toB64(authTag),
      aad_version: AAD_VERSION,
      ciphertext: toB64(ciphertext),
      updated_at: new Date().toISOString(),
      recovery_kdf: {
        algo: 'argon2id',
        salt: toB64(recoverySalt),
        m: ARGON2_PARAMS.m,
        t: ARGON2_PARAMS.t,
        p: ARGON2_PARAMS.p,
      },
    },
    recoveryCode,
    keyFile,
  }
}

/** 用密码、恢复码或密钥文件解密 vault blob。 */
export async function decryptVault(blob: VaultBlob, creds: UnlockCredentials): Promise<ExportData> {
  if (blob.version !== 1) throw new Error('不支持的备份版本')
  if (blob.aad_version !== AAD_VERSION) throw new Error('不支持的 AAD 版本')
  if (blob.kdf.algo !== 'argon2id') throw new Error('不支持的 KDF 算法')

  let mk: CryptoKey

  if (creds.keyFile) {
    if (creds.keyFile.vault_id !== blob.vault_id) {
      throw new Error('密钥文件与备份文件不匹配（vault_id 不一致）')
    }
    mk = await importKeyFromKeyFile(creds.keyFile)
  } else {
    let kek: CryptoKey
    let wrappedMk: Uint8Array
    if (creds.password) {
      kek = await deriveKekFromPassword(creds.password, fromB64(blob.kdf.salt))
      wrappedMk = fromB64(blob.encrypted_mk_by_password)
    } else if (creds.recoveryCode) {
      if (blob.recovery_kdf?.algo === 'argon2id') {
        kek = await deriveKekFromRecoveryCode(creds.recoveryCode, fromB64(blob.recovery_kdf.salt))
      } else {
        // 旧版 vault：恢复码走 HKDF（不抗离线暴力破解），仅用于兼容
        kek = await deriveKekFromRecoveryCodeLegacy(creds.recoveryCode)
      }
      wrappedMk = fromB64(blob.encrypted_mk_by_recovery)
    } else {
      throw new Error('需要提供密码、恢复码或密钥文件')
    }

    mk = await crypto.subtle.unwrapKey(
      'raw',
      wrappedMk as BufferSource,
      kek,
      { name: 'AES-KW' },
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    )
  }

  const combined = concatBytes(fromB64(blob.ciphertext), fromB64(blob.auth_tag))
  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(blob.iv) as BufferSource, additionalData: encodeAad(blob.vault_id, blob.revision) as BufferSource },
      mk,
      combined as BufferSource,
    )
  } catch {
    throw new Error('解密失败：密码/恢复码错误、密钥文件不匹配，或备份文件已损坏')
  }
  return JSON.parse(new TextDecoder().decode(plaintext))
}

/** 判断一个对象是否为加密 vault blob。 */
export function isVaultBlob(data: unknown): data is VaultBlob {
  return (
    !!data &&
    typeof data === 'object' &&
    (data as VaultBlob).version === 1 &&
    typeof (data as VaultBlob).kdf === 'object' &&
    typeof (data as VaultBlob).encrypted_mk_by_password === 'string'
  )
}

export function downloadFile(filename: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
