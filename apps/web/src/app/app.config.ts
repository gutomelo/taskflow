import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { appRoutes } from './app.routes';
import { provideAuth } from './core/auth';
import { organizationNotFoundInterceptor, provideOrganizations } from './core/organizations';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes, withComponentInputBinding()),
    provideAuth({ outerInterceptors: [organizationNotFoundInterceptor] }),
    provideOrganizations(),
  ],
};
