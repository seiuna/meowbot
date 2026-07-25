/**
 * StegoJar - 将任意字符串加密隐写到 JAR 中所有 class 文件的末尾
 * 
 * 使用 AES-256-CBC + PBKDF2 密码派生，需要密码才能解密
 * 
 * 原理：在每个 .class 文件的末尾追加加密数据
 * JVM 加载 class 时忽略末尾多余字节，反编译工具也不读取
 * 
 * 用法：
 *   隐写: java StegoJar write <输入.jar> <输出.jar> <密码> "要隐藏的内容"
 *   提取: java StegoJar read <jar路径> <密码>
 * 
 * 编译: javac StegoJar.java
 * 不需要任何第三方依赖，使用 Java 内置加密库
 */

import java.io.*;
import java.util.jar.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import javax.crypto.*;
import javax.crypto.spec.*;

public class StegoJar {

    private static final byte[] MAGIC = "STEG".getBytes();
    private static final int SALT_LEN = 16;
    private static final int IV_LEN = 16;
    private static final int KEY_LEN = 256; // AES-256
    private static final int ITERATIONS = 100000;

    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            printUsage();
            return;
        }

        String mode = args[0];

        if ("write".equalsIgnoreCase(mode)) {
            if (args.length < 5) {
                printUsage();
                return;
            }
            // write <input.jar> <output.jar> <password> <secret>
            write(args[1], args[2], args[3], args[4]);

        } else if ("read".equalsIgnoreCase(mode)) {
            if (args.length < 3) {
                printUsage();
                return;
            }
            // read <jar路径> <密码>
            read(args[1], args[2]);

        } else {
            System.out.println("未知模式: " + mode + "，支持: write / read");
        }
    }

    static void printUsage() {
        System.out.println("=== StegoJar - AES-256 加密隐写工具 ===");
        System.out.println();
        System.out.println("隐写字符串:");
        System.out.println("  java StegoJar write <输入.jar> <输出.jar> <密码> \"要隐藏的内容\"");
        System.out.println();
        System.out.println("提取隐藏内容:");
        System.out.println("  java StegoJar read <jar路径> <密码>");
        System.out.println();
        System.out.println("原理: AES-256-CBC 加密后藏在 .class 文件末尾，无密码无法解密");
    }

    // ==================== 写入 ====================

    static void write(String inputJar, String outputJar, String password, String secret) throws Exception {
        byte[] encrypted = encrypt(secret, password);
        int totalClasses = 0;

        try (JarInputStream jis = new JarInputStream(new FileInputStream(inputJar));
             JarOutputStream jos = new JarOutputStream(new FileOutputStream(outputJar))) {

            JarEntry entry;
            while ((entry = jis.getNextJarEntry()) != null) {
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = jis.read(buf)) != -1) {
                    baos.write(buf, 0, n);
                }
                byte[] entryData = baos.toByteArray();

                if (entry.getName().endsWith(".class") && !entry.getName().startsWith("META-INF/")) {
                    ByteArrayOutputStream modified = new ByteArrayOutputStream();
                    modified.write(entryData);
                    modified.write(MAGIC);
                    modified.write(encrypted);
                    entryData = modified.toByteArray();
                    totalClasses++;
                }

                JarEntry newEntry = new JarEntry(entry.getName());
                newEntry.setTime(entry.getTime());
                newEntry.setComment(entry.getComment());
                jos.putNextEntry(newEntry);
                jos.write(entryData);
                jos.closeEntry();
            }
        }

        System.out.println("[OK] 加密隐写完成！");
        System.out.println("    加密后数据长度: " + encrypted.length + " 字节");
        System.out.println("    写入到 " + totalClasses + " 个 class 文件中");
        System.out.println("    输出文件: " + outputJar);
        System.out.println("    提取时需要密码才能解密");
    }

    // ==================== 读取 ====================

    static void read(String jarPath, String password) throws Exception {
        int checkedClasses = 0;

        try (JarInputStream jis = new JarInputStream(new FileInputStream(jarPath))) {
            JarEntry entry;
            while ((entry = jis.getNextJarEntry()) != null) {
                if (!entry.getName().endsWith(".class")) continue;

                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = jis.read(buf)) != -1) {
                    baos.write(buf, 0, n);
                }
                byte[] classBytes = baos.toByteArray();
                checkedClasses++;

                int magicPos = lastIndexOf(classBytes, MAGIC);
                if (magicPos < 0) continue;

                int encPos = magicPos + MAGIC.length;
                int encLen = classBytes.length - encPos;

                if (encLen < SALT_LEN + IV_LEN + 1) {
                    System.out.println("[警告] " + entry.getName() + " 中加密数据过短，跳过");
                    continue;
                }

                byte[] encrypted = new byte[encLen];
                System.arraycopy(classBytes, encPos, encrypted, 0, encLen);

                try {
                    String secret = decrypt(encrypted, password);
                    System.out.println("[成功] 发现并解密隐藏数据！");
                    System.out.println("    来源文件: " + entry.getName());
                    System.out.println("    加密数据长度: " + encLen + " 字节");
                    System.out.println("    === 隐藏内容如下 ===");
                    System.out.println(secret);
                    System.out.println("    ==================");
                    return;
                } catch (Exception e) {
                    System.out.println("[错误] 解密失败: " + e.getMessage());
                    System.out.println("    密码错误或数据已损坏");
                    return;
                }
            }
        }

        System.out.println("[未找到] 已扫描 " + checkedClasses + " 个 class 文件，未发现隐藏数据");
    }

    // ==================== 加密 ====================

    static byte[] encrypt(String plaintext, String password) throws Exception {
        SecureRandom random = new SecureRandom();

        // 生成随机 salt
        byte[] salt = new byte[SALT_LEN];
        random.nextBytes(salt);

        // 派生密钥
        SecretKey key = deriveKey(password, salt);

        // 生成随机 IV
        byte[] iv = new byte[IV_LEN];
        random.nextBytes(iv);
        IvParameterSpec ivSpec = new IvParameterSpec(iv);

        // 加密
        Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
        cipher.init(Cipher.ENCRYPT_MODE, key, ivSpec);
        byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));

        // 组装: salt + iv + ciphertext
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(salt);
        out.write(iv);
        out.write(toBytes(ciphertext.length));
        out.write(ciphertext);
        return out.toByteArray();
    }

    // ==================== 解密 ====================

    static String decrypt(byte[] encrypted, String password) throws Exception {
        int offset = 0;

        // 读取 salt
        byte[] salt = new byte[SALT_LEN];
        System.arraycopy(encrypted, offset, salt, 0, SALT_LEN);
        offset += SALT_LEN;

        // 读取 IV
        byte[] iv = new byte[IV_LEN];
        System.arraycopy(encrypted, offset, iv, 0, IV_LEN);
        offset += IV_LEN;
        IvParameterSpec ivSpec = new IvParameterSpec(iv);

        // 读取密文长度
        int ctLen = toInt(encrypted, offset);
        offset += 4;

        // 读取密文
        byte[] ciphertext = new byte[ctLen];
        System.arraycopy(encrypted, offset, ciphertext, 0, ctLen);

        // 派生密钥
        SecretKey key = deriveKey(password, salt);

        // 解密
        Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
        cipher.init(Cipher.DECRYPT_MODE, key, ivSpec);
        byte[] plaintext = cipher.doFinal(ciphertext);

        return new String(plaintext, StandardCharsets.UTF_8);
    }

    // ==================== 密钥派生 ====================

    static SecretKey deriveKey(String password, byte[] salt) throws Exception {
        PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, ITERATIONS, KEY_LEN);
        SecretKeyFactory factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
        byte[] keyBytes = factory.generateSecret(spec).getEncoded();
        return new SecretKeySpec(keyBytes, "AES");
    }

    // ==================== 工具方法 ====================

    static byte[] toBytes(int v) {
        return new byte[] {
            (byte) (v >> 24),
            (byte) (v >> 16),
            (byte) (v >> 8),
            (byte) v
        };
    }

    static int toInt(byte[] data, int offset) {
        return ((data[offset] & 0xFF) << 24) |
               ((data[offset + 1] & 0xFF) << 16) |
               ((data[offset + 2] & 0xFF) << 8) |
               (data[offset + 3] & 0xFF);
    }

    static int lastIndexOf(byte[] src, byte[] pattern) {
        if (pattern.length == 0 || src.length < pattern.length) return -1;
        outer:
        for (int i = src.length - pattern.length; i >= 0; i--) {
            for (int j = 0; j < pattern.length; j++) {
                if (src[i + j] != pattern[j]) continue outer;
            }
            return i;
        }
        return -1;
    }
}
