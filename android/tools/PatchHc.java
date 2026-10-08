import org.objectweb.asm.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;
import java.io.*;

/**
 * Patches androidx.health.connect:connect-client classes.jar so D8 8.2.2 can dex it.
 * The AAR ships MethodParameters attributes with null parameter names, which
 * crashes D8 ("Cannot invoke String.length() because <parameter1> is null").
 * Dropping MethodParameters (debug-only info) plus type-use annotations fixes it.
 * Usage: java -cp asm.jar:tools PatchHc <in.jar> <out.jar>
 */
public class PatchHc {
    static byte[] strip(byte[] in) {
        ClassReader cr = new ClassReader(in);
        ClassWriter cw = new ClassWriter(cr, 0);
        cr.accept(new ClassVisitor(Opcodes.ASM9, cw) {
            @Override public MethodVisitor visitMethod(int acc, String n, String d, String s, String[] e) {
                MethodVisitor mv = super.visitMethod(acc, n, d, null, e);
                return new MethodVisitor(Opcodes.ASM9, mv) {
                    @Override public void visitParameter(String name, int access) {}
                    @Override public AnnotationVisitor visitTypeAnnotation(int tr, TypePath tp, String dd, boolean vv) { return null; }
                };
            }
            @Override public FieldVisitor visitField(int acc, String n, String d, String s, Object v) {
                return new FieldVisitor(Opcodes.ASM9, super.visitField(acc, n, d, null, v)) {
                    @Override public AnnotationVisitor visitTypeAnnotation(int tr, TypePath tp, String dd, boolean vv) { return null; }
                };
            }
            @Override public AnnotationVisitor visitTypeAnnotation(int tr, TypePath tp, String d, boolean v) { return null; }
        }, 0);
        return cw.toByteArray();
    }
    public static void main(String[] a) throws Exception {
        int n = 0;
        try (ZipFile zf = new ZipFile(a[0]);
             ZipOutputStream zos = new ZipOutputStream(new BufferedOutputStream(Files.newOutputStream(Paths.get(a[1]))))) {
            Enumeration<? extends ZipEntry> en = zf.entries();
            while (en.hasMoreElements()) {
                ZipEntry e = en.nextElement();
                byte[] data;
                try (InputStream is = zf.getInputStream(e)) { data = is.readAllBytes(); }
                if (e.getName().endsWith(".class")) { data = strip(data); n++; }
                ZipEntry ne = new ZipEntry(e.getName());
                ne.setTime(e.getTime());
                zos.putNextEntry(ne);
                zos.write(data);
                zos.closeEntry();
            }
        }
        System.out.println("  patched " + n + " classes in " + a[1]);
    }
}
