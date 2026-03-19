import fs from "node:fs/promises";
import path from "node:path";

import type { LabRun, MemoryNote } from "../domain/types.js";

export class FileStore {
  private readonly runsDir: string;
  private readonly memoryFile: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dataDir: string) {
    this.runsDir = path.join(dataDir, "runs");
    this.memoryFile = path.join(dataDir, "memory.json");
  }

  async init(): Promise<void> {
    await fs.mkdir(this.runsDir, { recursive: true });

    try {
      await fs.access(this.memoryFile);
    } catch {
      await fs.writeFile(this.memoryFile, "[]", "utf8");
    }
  }

  async saveRun(run: LabRun): Promise<void> {
    await this.withWriteLock(async () => {
      const filePath = path.join(this.runsDir, `${run.id}.json`);
      await fs.writeFile(filePath, JSON.stringify(run, null, 2), "utf8");
    });
  }

  async getRun(runId: string): Promise<LabRun | null> {
    await this.writeQueue;
    const filePath = path.join(this.runsDir, `${runId}.json`);

    try {
      const content = await fs.readFile(filePath, "utf8");
      return JSON.parse(content) as LabRun;
    } catch {
      return null;
    }
  }

  async listRuns(): Promise<LabRun[]> {
    await this.writeQueue;
    const files = await fs.readdir(this.runsDir);
    const runs = await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map(async (file) => {
          const content = await fs.readFile(path.join(this.runsDir, file), "utf8");
          return JSON.parse(content) as LabRun;
        })
    );

    return runs.sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt)
    );
  }

  async listMemory(): Promise<MemoryNote[]> {
    await this.writeQueue;
    const content = await fs.readFile(this.memoryFile, "utf8");
    return JSON.parse(content) as MemoryNote[];
  }

  async appendMemory(notes: MemoryNote[]): Promise<void> {
    await this.withWriteLock(async () => {
      const content = await fs.readFile(this.memoryFile, "utf8");
      const current = JSON.parse(content) as MemoryNote[];
      current.push(...notes);
      await fs.writeFile(this.memoryFile, JSON.stringify(current, null, 2), "utf8");
    });
  }

  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(operation, operation);
    this.writeQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}
