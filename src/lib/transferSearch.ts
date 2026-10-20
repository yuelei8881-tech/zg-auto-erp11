export function matchesTransferOwner(name: string, phone: string | undefined, query: string): boolean {
  const text = query.trim().toLowerCase();
  if (!text || name.toLowerCase().includes(text)) return true;
  const digits = text.replace(/\D/g, '');
  return digits.length > 0 && /^[+\d\s().-]+$/.test(text)
    && (phone || '').replace(/\D/g, '').includes(digits);
}
