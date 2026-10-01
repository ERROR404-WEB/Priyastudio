import { z } from 'zod';
import { GOOGLE_SCOPE, type CalendarConfig } from './config';
import { decrypt, encrypt } from './crypto';
import { GoogleFailure, type GoogleTokens, type GoogleTransport } from './google';
import type { Lease } from './model';
import type { CalendarRepository } from './repository';

const tokenSchema = z.object({ accessToken: z.string().min(1), refreshToken: z.string().min(1), expiresAt: z.number().finite(), scope: z.string() });
export function readCredentials(envelope: string, config: CalendarConfig, owner: string, epoch: number): GoogleTokens & { refreshToken: string } {
  try {
    const value = tokenSchema.parse(JSON.parse(decrypt(envelope, config.encryptionKey, `credentials:${owner}:${epoch}`)));
    if (!value.scope.split(/\s+/).includes(GOOGLE_SCOPE)) throw new Error();
    return value;
  } catch { throw new GoogleFailure(true); }
}
export class LeaseLost extends Error {}
/** A fresh vault per leased operation; tokens are never cached globally or placed in StudioState. */
export class CredentialVault {
  private cached?: GoogleTokens & { refreshToken: string };
  constructor(private readonly repo: CalendarRepository, private readonly config: CalendarConfig, private readonly google: GoogleTransport) {}
  async access(lease: Lease, forceRefresh = false): Promise<string> {
    if (!await this.repo.valid(lease)) throw new LeaseLost();
    if (!lease.credentials) throw new GoogleFailure(true);
    let value = this.cached ?? readCredentials(lease.credentials, this.config, lease.owner, lease.epoch);
    if (forceRefresh || value.expiresAt <= Date.now() + 60_000) {
      const fresh = await this.google.refresh(value.refreshToken);
      if (!fresh.accessToken || !Number.isFinite(fresh.expiresAt) || fresh.expiresAt <= Date.now()
        || (fresh.scope !== undefined && !fresh.scope.split(/\s+/).includes(GOOGLE_SCOPE))) throw new GoogleFailure(true);
      value = { ...fresh, refreshToken: fresh.refreshToken || value.refreshToken, scope: fresh.scope ?? value.scope };
      const envelope = encrypt(JSON.stringify(value), this.config.encryptionKey, `credentials:${lease.owner}:${lease.epoch}`);
      if (!await this.repo.replaceCredentials(lease, envelope)) throw new LeaseLost();
    }
    this.cached = value;
    return value.accessToken;
  }
  async invalidate(lease: Lease): Promise<void> {
    const result = await this.repo.disconnect(lease.owner, true, lease.epoch, lease);
    if (result) await this.repo.endDisconnect(lease.owner, result.epoch);
  }
}