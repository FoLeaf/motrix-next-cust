import { describe, expect, it } from 'vitest'
import { isValidOptionalIpAddress } from '@shared/utils/ipAddress'

describe('isValidOptionalIpAddress', () => {
  it.each(['', '  ', '192.0.2.1', '203.0.113.255', '2001:db8::1', '::1', '::ffff:192.0.2.1'])('accepts %s', (value) => {
    expect(isValidOptionalIpAddress(value)).toBe(true)
  })

  it.each(['example.com', '192.0.2', '192.0.2.999', '01.2.3.4', '1.2.3.-1', '2001:db8:::1', '[2001:db8::1]'])(
    'rejects %s',
    (value) => {
      expect(isValidOptionalIpAddress(value)).toBe(false)
    },
  )
})
