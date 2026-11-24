export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export class GoogleOAuth {
  private tokenCache = new Map<string, { token: string; expiresAt: number }>();
  private inFlightRefreshes = new Map<string, Promise<string>>();

  constructor(
    private clientId: string,
    private clientSecret: string,
    private redirectUri: string
  ) {}

  private hashKey(refreshToken: string): string {
    return new Bun.CryptoHasher("sha256").update(refreshToken).digest("hex");
  }

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  getAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email",
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<GoogleTokens> {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!res.ok) {
      throw new Error(`Google token exchange gagal: ${await res.text()}`);
    }

    return (await res.json()) as GoogleTokens;
  }

  async refreshAccessToken(refreshToken: string): Promise<string> {
    const cacheKey = this.hashKey(refreshToken);
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
      return cached.token;
    }

    const inFlight = this.inFlightRefreshes.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const refreshPromise = (async () => {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          refresh_token: refreshToken,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: "refresh_token",
        }),
      });

      if (!res.ok) {
        this.tokenCache.delete(cacheKey);
        throw new Error(`Google token refresh gagal: ${await res.text()}`);
      }

      const data = (await res.json()) as { access_token: string; expires_in?: number };
      const ttlMs = Math.max(60, Number(data.expires_in || 3600)) * 1000;
      this.tokenCache.set(cacheKey, {
        token: data.access_token,
        expiresAt: Date.now() + ttlMs,
      });
      return data.access_token;
    })();

    this.inFlightRefreshes.set(cacheKey, refreshPromise);
    try {
      return await refreshPromise;
    } finally {
      this.inFlightRefreshes.delete(cacheKey);
    }
  }
}
