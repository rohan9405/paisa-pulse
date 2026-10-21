package dev.paisapulse.app;

import android.content.ContentResolver;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.webkit.JavascriptInterface;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * `window.PaisaFiles` in the page (see src/data/backup.ts): saving exports and
 * writing automatic backups to a folder the user picked once. Backups live
 * outside the app, so they survive an uninstall or "Clear data".
 */
final class FilesBridge {
    static final int SAVE_REQUEST = 3;
    static final int FOLDER_REQUEST = 4;
    static final String BACKUP_PREFIX = "paisa-pulse-backup-";
    private static final String PREFS = "files";
    private static final String KEY_FOLDER = "backupFolder";

    private final MainActivity activity;
    private String pendingSave;

    FilesBridge(MainActivity activity) {
        this.activity = activity;
    }

    /** Asks where to save, then writes `content` there. */
    @JavascriptInterface
    public void save(String name, String mime, String content) {
        pendingSave = content;
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE, name);
        activity.runOnUiThread(() -> activity.startActivityForResult(i, SAVE_REQUEST));
    }

    void onSaveResult(Uri uri) {
        String content = pendingSave;
        pendingSave = null;
        if (uri == null || content == null) return;
        boolean ok = write(uri, content);
        activity.emit(ok ? "paisa-file-saved" : "paisa-file-save-failed");
    }

    @JavascriptInterface
    public void chooseBackupFolder() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        activity.runOnUiThread(() -> activity.startActivityForResult(i, FOLDER_REQUEST));
    }

    void onFolderResult(Uri tree) {
        if (tree == null) return;
        activity.getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        prefs().edit().putString(KEY_FOLDER, tree.toString()).apply();
        activity.emit("paisa-backup-folder");
    }

    /** Display name of the backup folder, or "" if none is set or access was revoked. */
    @JavascriptInterface
    public String backupFolder() {
        Uri tree = folder();
        if (tree == null) return "";
        try (Cursor c = activity.getContentResolver().query(rootDoc(tree), new String[] {DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            return c != null && c.moveToFirst() ? c.getString(0) : "";
        } catch (Exception e) {
            return "";
        }
    }

    /** Writes (or overwrites) `name` in the backup folder and keeps only the newest `keep` backups. */
    @JavascriptInterface
    public boolean writeBackup(String name, String content, int keep) {
        Uri tree = folder();
        if (tree == null || !name.startsWith(BACKUP_PREFIX)) return false;
        try {
            ContentResolver cr = activity.getContentResolver();
            List<String[]> backups = children(tree); // [documentId, name]
            Uri target = null;
            for (String[] b : backups) if (b[1].equals(name)) target = DocumentsContract.buildDocumentUriUsingTree(tree, b[0]);
            if (target == null) target = DocumentsContract.createDocument(cr, rootDoc(tree), "application/json", name);
            if (target == null || !write(target, content)) return false;

            List<String[]> all = children(tree);
            Collections.sort(all, (a, b) -> b[1].compareTo(a[1])); // names carry the date: newest first
            for (int i = keep; i < all.size(); i++) DocumentsContract.deleteDocument(cr, DocumentsContract.buildDocumentUriUsingTree(tree, all.get(i)[0]));
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private List<String[]> children(Uri tree) {
        List<String[]> out = new ArrayList<>();
        Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        try (Cursor c = activity.getContentResolver().query(kids, new String[] {DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            while (c != null && c.moveToNext()) {
                String n = c.getString(1);
                if (n != null && n.startsWith(BACKUP_PREFIX) && n.endsWith(".json")) out.add(new String[] {c.getString(0), n});
            }
        }
        return out;
    }

    private boolean write(Uri uri, String content) {
        try (OutputStream out = activity.getContentResolver().openOutputStream(uri, "wt")) {
            if (out == null) return false;
            out.write(content.getBytes(StandardCharsets.UTF_8));
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private Uri folder() {
        String s = prefs().getString(KEY_FOLDER, null);
        if (s == null) return null;
        Uri tree = Uri.parse(s);
        for (android.content.UriPermission p : activity.getContentResolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(tree) && p.isWritePermission()) return tree;
        }
        return null;
    }

    private static Uri rootDoc(Uri tree) {
        return DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
    }

    private SharedPreferences prefs() {
        return activity.getSharedPreferences(PREFS, 0);
    }
}
