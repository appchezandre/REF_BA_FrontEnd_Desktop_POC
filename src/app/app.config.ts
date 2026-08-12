import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { maintenanceInterceptor } from './core/maintenance/maintenance.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // `maintenanceInterceptor` en premier : il court-circuite les requêtes
    // pendant une maintenance, avant toute pose de Bearer ou tentative de
    // renouvellement par `authInterceptor`.
    provideHttpClient(withInterceptors([maintenanceInterceptor, authInterceptor]))
  ]
};
