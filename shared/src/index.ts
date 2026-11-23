// API contract shared by server and web. Imported as `@app/shared`.
// The package exports this .ts file directly (no build step), so both sides
// always read the current schema.
export * from './error.js';
export * from './health.js';
export * from './login.js';
export * from './registration.js';
