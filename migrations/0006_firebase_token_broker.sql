CREATE TABLE firebase_service_tokens (
  project TEXT NOT NULL, fingerprint TEXT NOT NULL,
  nonce TEXT NOT NULL, ciphertext TEXT NOT NULL, expires_at INTEGER NOT NULL,
  PRIMARY KEY(project,fingerprint)
);
