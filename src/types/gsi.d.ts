interface GsiTokenClient {
  requestAccessToken: (opts?: { prompt?: string }) => void;
}

interface GsiTokenClientConfig {
  client_id: string;
  scope: string;
  prompt?: string;
  callback: (resp: {
    access_token?: string;
    error?: string;
    error_description?: string;
  }) => void;
  error_callback?: (err: { type?: string; message?: string }) => void;
}

interface Window {
  google?: {
    accounts?: {
      oauth2?: {
        initTokenClient: (config: GsiTokenClientConfig) => GsiTokenClient;
      };
    };
  };
}
