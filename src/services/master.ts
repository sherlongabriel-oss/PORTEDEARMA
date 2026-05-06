import fs from "fs/promises";
import path from "path";

const dataDir = path.resolve("data");
const masterFile = path.join(dataDir, "master.json");

interface MasterRecord {
  jid: string;
  updatedAt: string;
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
}

export async function getMasterJid(): Promise<string | null> {
  try {
    const raw = await fs.readFile(masterFile, "utf8");
    const parsed = JSON.parse(raw) as MasterRecord;
    return parsed.jid || null;
  } catch {
    return null;
  }
}

export async function setMasterJid(jid: string): Promise<void> {
  await ensureDir();
  const payload: MasterRecord = {
    jid,
    updatedAt: new Date().toISOString()
  };
  await fs.writeFile(masterFile, JSON.stringify(payload, null, 2), "utf8");
}

export async function clearMasterJid(): Promise<void> {
  try {
    await fs.unlink(masterFile);
  } catch {
    // ignore
  }
}
