// Extracted from production dist/index.js
// Original module: server/utils/cryptoService.ts
// Lines: 136

var cryptoService_exports = {};
__export(cryptoService_exports, {
  decrypt: () => decrypt,
  encrypt: () => encrypt,
  isCryptoAvailable: () => isCryptoAvailable,
  isEncrypted: () => isEncrypted,
  safeDecrypt: () => safeDecrypt,
  safeEncrypt: () => safeEncrypt,
  selfTest: () => selfTest
});
function getEncryptionKey() {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error(
      "[CryptoService] ENCRYPTION_KEY \u73AF\u5883\u53D8\u91CF\u672A\u914D\u7F6E\u3002\u8BF7\u5728 Elastic Beanstalk \u73AF\u5883\u53D8\u91CF\u4E2D\u8BBE\u7F6E\u4E00\u4E2A 64 \u5B57\u7B26\u7684 hex \u5B57\u7B26\u4E32\u3002"
    );
  }
  if (keyHex.length !== 64) {
    throw new Error(
      `[CryptoService] ENCRYPTION_KEY \u957F\u5EA6\u9519\u8BEF: \u671F\u671B 64 hex \u5B57\u7B26 (32 \u5B57\u8282), \u5B9E\u9645 ${keyHex.length} \u5B57\u7B26\u3002`
    );
  }
  return Buffer.from(keyHex, "hex");
}
function isEncrypted(value) {
  return value.startsWith(ENCRYPTED_PREFIX);
}
function encrypt(plaintext) {
  if (!plaintext || plaintext.trim() === "") {
    return plaintext;
  }
  if (isEncrypted(plaintext)) {
    return plaintext;
  }
  const key = getEncryptionKey();
  const iv = import_crypto.default.randomBytes(IV_LENGTH);
  const cipher = import_crypto.default.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH
  });
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${ENCRYPTED_PREFIX}${iv.toString("hex")}:${authTag}:${encrypted}`;
}
function decrypt(ciphertext) {
  if (!ciphertext || ciphertext.trim() === "") {
    return ciphertext;
  }
  if (!isEncrypted(ciphertext)) {
    return ciphertext;
  }
  const key = getEncryptionKey();
  const withoutPrefix = ciphertext.slice(ENCRYPTED_PREFIX.length);
  const parts = withoutPrefix.split(":");
  if (parts.length !== 3) {
    throw new Error(
      `[CryptoService] \u52A0\u5BC6\u6570\u636E\u683C\u5F0F\u9519\u8BEF: \u671F\u671B 3 \u4E2A\u90E8\u5206 (iv:authTag:ciphertext), \u5B9E\u9645 ${parts.length} \u4E2A\u90E8\u5206\u3002`
    );
  }
  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = import_crypto.default.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH
  });
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
function safeEncrypt(plaintext) {
  try {
    return encrypt(plaintext);
  } catch (error48) {
    log13.warn(`[CryptoService] \u52A0\u5BC6\u5931\u8D25\uFF0C\u8FD4\u56DE\u660E\u6587: ${error48.message}`);
    return plaintext;
  }
}
function safeDecrypt(ciphertext) {
  try {
    return decrypt(ciphertext);
  } catch (error48) {
    log13.warn(`[CryptoService] \u89E3\u5BC6\u5931\u8D25\uFF0C\u8FD4\u56DE\u539F\u59CB\u503C: ${error48.message}`);
    return ciphertext;
  }
}
function isCryptoAvailable() {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}
function selfTest() {
  try {
    const testPlaintext = "crypto-service-self-test-" + Date.now();
    const encrypted = encrypt(testPlaintext);
    if (!isEncrypted(encrypted)) {
      return { success: false, error: "\u52A0\u5BC6\u7ED3\u679C\u7F3A\u5C11\u6B63\u786E\u524D\u7F00" };
    }
    const decrypted = decrypt(encrypted);
    if (decrypted !== testPlaintext) {
      return { success: false, error: "\u89E3\u5BC6\u7ED3\u679C\u4E0E\u539F\u6587\u4E0D\u5339\u914D" };
    }
    const doubleEncrypted = encrypt(encrypted);
    if (doubleEncrypted !== encrypted) {
      return { success: false, error: "\u91CD\u590D\u52A0\u5BC6\u672A\u4FDD\u6301\u5E42\u7B49\u6027" };
    }
    return { success: true };
  } catch (error48) {
    return { success: false, error: error48.message };
  }
}
var import_crypto, log13, ALGORITHM, IV_LENGTH, AUTH_TAG_LENGTH, ENCRYPTED_PREFIX;
var init_cryptoService = __esm({
  "server/utils/cryptoService.ts"() {
    "use strict";
    import_crypto = __toESM(require("crypto"));
    init_logger();
    log13 = createModuleLogger("Crypto");
    ALGORITHM = "aes-256-gcm";
    IV_LENGTH = 12;
    AUTH_TAG_LENGTH = 16;
    ENCRYPTED_PREFIX = "enc:v1:";
    __name(getEncryptionKey, "getEncryptionKey");
    __name(isEncrypted, "isEncrypted");
    __name(encrypt, "encrypt");
    __name(decrypt, "decrypt");
    __name(safeEncrypt, "safeEncrypt");
    __name(safeDecrypt, "safeDecrypt");
    __name(isCryptoAvailable, "isCryptoAvailable");
    __name(selfTest, "selfTest");
  }
});

