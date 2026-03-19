/**
 * Mock Session Library
 * Used when API keys are missing or for demo purposes.
 */

const MOCK_PHRASES = [
  "Hello everyone, welcome to the international conference.",
  "We are excited to discuss the future of AI interpretation.",
  "This technology allows us to break language barriers in real-time.",
  "InterpShield provides a secure and professional environment for translation.",
  "Let's begin our session by selecting the source and target languages."
];

const MOCK_TRANSLATIONS: Record<string, string[]> = {
  'es': [
    "Hola a todos, bienvenidos a la conferencia internacional.",
    "Estamos emocionados de discutir el futuro de la interpretación de IA.",
    "Esta tecnología nos permite romper las barreras del idioma en tiempo real.",
    "InterpShield proporciona un entorno seguro y profesional para la traducción.",
    "Comencemos nuestra sesión seleccionando los idiomas de origen y destino."
  ],
  'fr': [
    "Bonjour à tous, bienvenue à la conférence internationale.",
    "Nous sommes ravis de discuter de l'avenir de l'interprétation par l'IA.",
    "Cette technologie nous permet de briser les barrières linguistiques en temps réel.",
    "InterpShield offre un environnement sécurisé et professionnel pour la traduction.",
    "Commençons notre session en sélectionnant les langues source et cible."
  ]
};

export const getMockTranscript = (index: number): string => {
  return MOCK_PHRASES[index % MOCK_PHRASES.length];
};

export const getMockTranslation = (index: number, targetLang: string): string => {
  const translations = MOCK_TRANSLATIONS[targetLang] || MOCK_PHRASES.map(p => `[Translated to ${targetLang}] ${p}`);
  return translations[index % translations.length];
};
