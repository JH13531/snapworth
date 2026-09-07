import { describe, it, expect } from 'vitest'
import { categoryLabel } from '@/types'

describe('categoryLabel', () => {
  it('预设分类返回 i18n 翻译', () => {
    // 当前默认语言为 zh：category.cash -> 现金/活期
    expect(categoryLabel('cash')).toBe('现金/活期')
  })

  it('自定义分类名直接返回原字符串，而非被加前缀', () => {
    // 回归保护：升级版曾误改为 tl('category.'+key)，会把「养老金」显示成「category.养老金」
    expect(categoryLabel('养老金')).toBe('养老金')
    expect(categoryLabel('数字资产')).toBe('数字资产')
  })

  it('未知预设 key 也回退为原值，不会抛出', () => {
    expect(categoryLabel('some_unknown_key')).toBe('some_unknown_key')
  })
})
