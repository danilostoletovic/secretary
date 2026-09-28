// Only publish information you want visitors to receive. null means unknown.
export const danilo = {
  about: {
    name: 'Danilo Stoletović',
    portfolio: 'https://danilostoletovic.com',
    bio: null, // TODO: Add an approved professional biography.
  },
  services: [] as string[], // TODO: Add services actually offered.
  technologies: [] as string[], // TODO: Add verified technologies.
  projects: [] as { name: string; description: string; url: string }[],
  // TODO: Add public projects above.
  contact: {
    website: 'https://danilostoletovic.com',
    email: null, // TODO: Add a public business email.
    bookingUrl: null, // TODO: Add a booking link if available.
  },
  faqs: [] as { question: string; answer: string }[], // TODO: Add approved answers.
};
