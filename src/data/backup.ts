/**
 * Automatic backups in the Android app (android/.../FilesBridge.java exposes
 * `window.PaisaFiles`). One file per day in a folder the user picks once,
 * newest KEEP kept. The folder is outside the app, so backups survive an
 * uninstall or "Clear data"; restore them from Settings or the welcome screen.
 */
import { toISTKey } from "@/lib/dates";
import type { AppMode } from "@/lib/types";
import type { FinanceDB } from "./db";
import { exportAll } from "./repo";

export interface FilesBridge {
  /** Opens Android's "save as" and writes the content; fires `paisa-file-saved` / `paisa-file-save-failed`. */
  save(name: string, mime: string, content: string): void;
  /** Opens Android's folder picker; fires `paisa-backup-folder` once chosen. */
  chooseBackupFolder(): void;
  /** Folder name, or "" if none is chosen or access was revoked. */
  backupFolder(): string;
  writeBackup(name: string, content: string, keep: number): boolean;
}

declare global {
  interface Window {
    PaisaFiles?: FilesBridge;
  }
}

export function filesBridge(): FilesBridge | null {
  return typeof window !== "undefined" && window.PaisaFiles ? window.PaisaFiles : null;
}

const KEEP = 14;
const LAST_KEY = "paisa-pulse:last-backup";

export function lastBackupAt(): number | null {
  try {
    const v = Number(window.localStorage.getItem(LAST_KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Writes today's backup of personal data. Returns the file name, or null if there's no folder or it failed. */
export async function backupNow(db: FinanceDB, mode: AppMode): Promise<string | null> {
  const files = filesBridge();
  if (!files || mode !== "personal" || !files.backupFolder()) return null;
  if (!(await db.profile.get("me"))) return null;
  const name = `paisa-pulse-backup-${toISTKey()}.json`;
  if (!files.writeBackup(name, JSON.stringify(await exportAll(db, mode)), KEEP)) return null;
  try {
    window.localStorage.setItem(LAST_KEY, String(Date.now()));
  } catch {
    /* only used to show "last backup" */
  }
  return name;
}

/** Download in a browser; Android's save dialog in the app (WebView can't download blobs). */
export function saveFile(name: string, body: string, type: string) {
  const files = filesBridge();
  if (files) return files.save(name, type, body);
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
