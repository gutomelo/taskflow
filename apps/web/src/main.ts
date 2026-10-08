import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig).catch((error: unknown) => {
  // Falha de bootstrap acontece antes de qualquer serviço de log existir.
  // eslint-disable-next-line no-console
  console.error(error);
});
