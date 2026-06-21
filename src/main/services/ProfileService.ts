import { app } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';

export interface Profile {
  name: string;
  cookie: string;
  apiKey: string;
  groupId: string;
  concurrent?: boolean;
}

export interface ProfileSecrets {
  activeProfileId: string | null;
  profiles: Record<string, Profile>;
}

export class ProfileService {
  private static writeQueue = Promise.resolve();

  private static getProfileSecretsPath(): string {
    return path.join(app.getPath('userData'), 'profile-secrets.json');
  }

  private static async readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
    try {
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data) as T;
    } catch {
      return fallback;
    }
  }

  private static async writeJsonFile(filePath: string, value: any): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf8');
    try {
      await fs.rename(tmpPath, filePath);
    } catch (err: any) {
      if (!['EACCES', 'EPERM', 'EEXIST'].includes(err?.code)) {
        await fs.rm(tmpPath, { force: true }).catch(() => {});
        throw err;
      }
      await fs.copyFile(tmpPath, filePath);
      await fs.rm(tmpPath, { force: true }).catch(() => {});
    }
  }

  private static migrateProfileSecrets(allSecrets: any): ProfileSecrets {
    if (!allSecrets || !allSecrets.profiles) {
      const oldProfiles = { ...allSecrets };
      delete oldProfiles.activeProfileId;
      return {
        activeProfileId: 'default',
        profiles: Object.keys(oldProfiles).length > 0 ? oldProfiles : {
          default: { name: 'Default Profile', cookie: '', apiKey: '', groupId: '', concurrent: true }
        }
      };
    }
    return allSecrets;
  }

  public static async loadProfileSecrets(): Promise<ProfileSecrets> {
    const raw = await this.readJsonFile(this.getProfileSecretsPath(), {});
    const migrated = this.migrateProfileSecrets(raw);
    
    if (!migrated.profiles) migrated.profiles = {};
    if (Object.keys(migrated.profiles).length === 0) {
      migrated.profiles.default = { name: 'Default Profile', cookie: '', apiKey: '', groupId: '', concurrent: true };
    }
    if (!migrated.activeProfileId || !migrated.profiles[migrated.activeProfileId]) {
      migrated.activeProfileId = Object.keys(migrated.profiles)[0] || null;
    }
    return migrated;
  }

  private static normalizeProfileSecrets(profile: any): Profile {
    return {
      name: String(profile.name || 'Unnamed Profile'),
      cookie: typeof profile.cookie === 'string' ? profile.cookie : '',
      apiKey: typeof profile.apiKey === 'string' ? profile.apiKey.trim() : '',
      groupId: typeof profile.groupId === 'string' ? profile.groupId.replace(/\D/g, '') : '',
      concurrent: profile.concurrent ?? true
    };
  }

  public static async saveProfileSecrets(payload: any): Promise<ProfileSecrets> {
    return new Promise((resolve, reject) => {
      this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
        try {
          const allSecrets = await this.loadProfileSecrets();
          
          if (payload.action === 'setActive') {
            const requestedId = String(payload.profileId || '');
            if (!allSecrets.profiles[requestedId]) throw new Error(`Profile "${requestedId}" does not exist.`);
            allSecrets.activeProfileId = requestedId;
          } else if (payload.action === 'saveProfile') {
            const pId = String(payload.profileId || `profile_${Date.now()}`);
            allSecrets.profiles[pId] = this.normalizeProfileSecrets(payload.secrets);
            if (!allSecrets.activeProfileId) allSecrets.activeProfileId = pId;
          } else if (payload.action === 'patchProfile') {
            const pId = String(payload.profileId || allSecrets.activeProfileId || 'default');
            const existing = allSecrets.profiles[pId] || { name: 'Unnamed Profile', cookie: '', apiKey: '', groupId: '' };
            allSecrets.profiles[pId] = this.normalizeProfileSecrets({ ...existing, ...payload.secrets });
            if (!allSecrets.activeProfileId) allSecrets.activeProfileId = pId;
          } else if (payload.action === 'deleteProfile') {
            delete allSecrets.profiles[payload.profileId];
            if (allSecrets.activeProfileId === payload.profileId) {
              const remaining = Object.keys(allSecrets.profiles);
              allSecrets.activeProfileId = remaining.length > 0 ? remaining[0] : null;
            }
          }

          await this.writeJsonFile(this.getProfileSecretsPath(), allSecrets);
          resolve(allSecrets);
        } catch (err) {
          reject(err);
        }
      });
    });
  }
}
