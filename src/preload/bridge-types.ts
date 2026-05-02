import type { CoworkApi } from '@shared/cowork-api';

declare global {
  interface Window {
    cowork: CoworkApi;
  }
}

export {};
