// Persona registry — importing this file registers all personas.
// Import this once at app init to make all personas available via getPersona().

export { type Persona, type PersonaName, getPersona, getAllPersonas } from './types.js';

// Side-effect imports: register each persona
import './coach.js';
import './cowork.js';
import './autonomous.js';
