export function validatePlayerRegistration(payload = {}) {
  const name = String(payload.name ?? '').trim();
  const email = String(payload.email ?? '').trim();
  const phone = String(payload.phone ?? '').trim();
  const whatsapp = String(payload.whatsapp ?? '').trim();

  if (!name || !email || !phone || !whatsapp) {
    throw new Error('Name, email, phone, and WhatsApp are required.');
  }

  if (!email.includes('@')) {
    throw new Error('A valid email is required.');
  }

  if (phone.length < 7 || whatsapp.length < 7) {
    throw new Error('Phone and WhatsApp must include a valid number.');
  }

  return {
    name,
    email,
    phone,
    whatsapp,
  };
}
