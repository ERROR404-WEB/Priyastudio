import { createHash, randomBytes } from 'node:crypto';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { HttpError } from '../errors';
import { GOOGLE_SCOPE, type CalendarConfig } from './config';
import { decrypt, encrypt } from './crypto';
import type { GoogleTransport } from './google';
import type { CalendarRepository } from './repository';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const invalid = () => new HttpError(400, 'Google connection was not completed. Start again from the shoot calendar.');
export class CalendarOAuth {
	constructor(private readonly repo: CalendarRepository, private readonly config: CalendarConfig, private readonly google: GoogleTransport) {}
	async begin(owner: string): Promise<{ url: string; browser: string }> {
		const lease = await this.repo.claim(owner);
		if (!lease) throw new HttpError(409, 'Calendar is busy. Try connecting again shortly.');
		try {
			if (lease.credentials) throw new HttpError(409, 'Disconnect the current calendar before connecting again.');
			const client = new OAuth2Client({ clientId: this.config.clientId, clientSecret: this.config.clientSecret, redirectUri: this.config.redirectUri });
			const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
			const state = randomBytes(32).toString('base64url'); const browser = randomBytes(32).toString('base64url');
			await this.repo.putOAuth(lease, hash(state), hash(browser), encrypt(codeVerifier, this.config.encryptionKey, `state:${owner}:${hash(state)}`));
			return { browser, url: client.generateAuthUrl({ scope: [GOOGLE_SCOPE], access_type: 'offline', prompt: 'consent select_account',
				include_granted_scopes: false, state, code_challenge: codeChallenge, code_challenge_method: CodeChallengeMethod.S256 }) };
		} finally { await this.repo.release(lease); }
	}
	async complete(owner: string, browser: string, query: { state?: string; code?: string; error?: string }): Promise<void> {
		if (!/^[A-Za-z0-9_-]{43}$/.test(query.state ?? '') || !/^[A-Za-z0-9_-]{43}$/.test(browser)) throw invalid();
		const state = await this.repo.consumeOAuth(owner, hash(query.state!), hash(browser));
		if (!state || query.error || !query.code || query.code.length > 4096) throw invalid();
		const lease = await this.repo.claim(owner);
		if (!lease) throw invalid();
		try {
			if (lease.epoch !== state.epoch || lease.credentials) throw invalid();
			const verifier = decrypt(state.verifier, this.config.encryptionKey, `state:${owner}:${state.stateHash}`);
			const tokens = await this.google.exchange(query.code, verifier);
			if (!tokens.refreshToken || !tokens.accessToken || !Number.isFinite(tokens.expiresAt) || tokens.expiresAt <= Date.now()
				|| !tokens.scope?.split(/\s+/).includes(GOOGLE_SCOPE)) throw invalid();
			const envelope = encrypt(JSON.stringify(tokens), this.config.encryptionKey, `credentials:${owner}:${lease.epoch + 1}`);
			if (!await this.repo.link(lease, envelope)) throw invalid();
		} catch { throw invalid(); }
		finally { await this.repo.release(lease); }
	}
}