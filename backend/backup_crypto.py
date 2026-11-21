"""Password-protected container for PASADA database backups.

The nightly ZIP is a plain archive: anyone who picks up the USB drive can read
every operator name, address, plate number and password hash inside it. This
module wraps those bytes in an authenticated container so a lost drive is a
lost drive, not a data breach.

Format v1, fixed header lengths:

    magic     5 bytes   b"PSDB1"
    salt      16 bytes  PBKDF2-HMAC-SHA256, 200,000 iterations, 32-byte key
    nonce     12 bytes  AES-256-GCM
    ciphertext rest     AES-GCM output (the 16-byte tag is appended by the library)

The header travels as associated data, so a truncated or edited file fails to
authenticate instead of decrypting into a half-database. A wrong password also
fails here: GCM cannot tell "wrong key" from "tampered", and both must be
refused rather than guessed at.

Only the standard `cryptography` package is used, which already ships with
PASADA for the LAN pairing keys.
"""
import os

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

MAGIC = b"PSDB1"
SALT_LEN = 16
NONCE_LEN = 12
KEY_LEN = 32
ITERATIONS = 200_000
EXTENSION = ".psdb"
MIN_PASSWORD_LENGTH = 8


class BackupPasswordError(ValueError):
    """Wrong password, or a container that was damaged after it was written."""


def derive_key(password: str, salt: bytes) -> bytes:
    if not password:
        raise BackupPasswordError("A backup password is required.")
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=KEY_LEN,
                     salt=salt, iterations=ITERATIONS)
    return kdf.derive(password.encode("utf-8"))


def encrypt_bytes(data: bytes, password: str) -> bytes:
    salt = os.urandom(SALT_LEN)
    nonce = os.urandom(NONCE_LEN)
    header = MAGIC + salt + nonce
    ciphertext = AESGCM(derive_key(password, salt)).encrypt(nonce, data, header)
    return header + ciphertext


def decrypt_bytes(blob: bytes, password: str) -> bytes:
    if not is_encrypted(blob):
        raise BackupPasswordError("This file is not an encrypted PASADA backup.")
    if len(blob) < len(MAGIC) + SALT_LEN + NONCE_LEN + 16:
        raise BackupPasswordError("This backup file is truncated.")
    salt = blob[len(MAGIC):len(MAGIC) + SALT_LEN]
    nonce = blob[len(MAGIC) + SALT_LEN:len(MAGIC) + SALT_LEN + NONCE_LEN]
    header = MAGIC + salt + nonce
    try:
        return AESGCM(derive_key(password, salt)).decrypt(nonce, blob[len(header):], header)
    except BackupPasswordError:
        raise
    except Exception as exc:  # InvalidTag and anything else means "not this key"
        raise BackupPasswordError(
            "That password did not open the backup, or the file is damaged."
        ) from exc


def is_encrypted(blob: bytes) -> bool:
    return blob[:len(MAGIC)] == MAGIC
