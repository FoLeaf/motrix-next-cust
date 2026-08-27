/** Returns whether the value is empty or a numeric IPv4/IPv6 address. */
export function isValidOptionalIpAddress(value: string): boolean {
  const address = value.trim()
  if (!address) return true

  if (address.includes(':')) {
    try {
      const url = new URL(`http://[${address}]/`)
      return url.hostname.startsWith('[') && url.hostname.endsWith(']')
    } catch {
      return false
    }
  }

  const octets = address.split('.')
  return (
    octets.length === 4 &&
    octets.every(
      (octet) =>
        /^\d{1,3}$/.test(octet) &&
        (octet === '0' || !octet.startsWith('0')) &&
        Number(octet) >= 0 &&
        Number(octet) <= 255,
    )
  )
}
