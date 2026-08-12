import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../../environments/environment';
import { maintenanceInterceptor } from './maintenance.interceptor';
import { MaintenanceService } from './maintenance.service';

const BASE = environment.apiBaseUrl;

describe('maintenanceInterceptor', () => {
  let http: HttpTestingController;
  let httpClient: HttpClient;
  let frozen: WritableSignal<boolean>;
  let inGrace: WritableSignal<boolean>;
  let initiatedLocally: WritableSignal<boolean>;
  let message: WritableSignal<string>;

  beforeEach(() => {
    frozen = signal(false);
    inGrace = signal(false);
    initiatedLocally = signal(false);
    message = signal('');

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([maintenanceInterceptor])),
        provideHttpClientTesting(),
        {
          provide: MaintenanceService,
          useValue: { frozen, inGrace, initiatedLocally, message }
        }
      ]
    });
    http = TestBed.inject(HttpTestingController);
    httpClient = TestBed.inject(HttpClient);
  });

  afterEach(() => {
    http.verify();
  });

  it('laisse passer les requêtes hors maintenance', () => {
    void firstValueFrom(httpClient.get(`${BASE}/api/users`));
    http.expectOne(`${BASE}/api/users`).flush([]);
  });

  it('ignore les URLs qui ne visent pas l’API métier', () => {
    frozen.set(true);
    void firstValueFrom(httpClient.get('https://exemple.fr/data'));
    http.expectOne('https://exemple.fr/data').flush({});
  });

  it('laisse tout passer pendant le sursis : l’utilisateur doit pouvoir enregistrer', () => {
    inGrace.set(true);

    void firstValueFrom(httpClient.put(`${BASE}/api/users`, { id: 'u-1' }));
    http.expectOne(`${BASE}/api/users`).flush({});

    // Le renouvellement de jeton doit rester possible, sinon un enregistrement
    // tardif échouerait en 401 pendant le sursis.
    void firstValueFrom(httpClient.post(`${BASE}/api/auth/refresh`, {}));
    http.expectOne(`${BASE}/api/auth/refresh`).flush({});
  });

  it('refuse d’ouvrir une session dès le sursis', async () => {
    inGrace.set(true);
    message.set('Maintenance dans 2 minutes.');

    await expect(
      firstValueFrom(httpClient.post(`${BASE}/api/auth/login`, {}))
    ).rejects.toMatchObject({
      status: 503,
      error: { title: 'Maintenance dans 2 minutes.' }
    });
    http.expectNone(`${BASE}/api/auth/login`);
  });

  it('refuse une écriture une fois l’application figée, sans l’émettre sur le réseau', async () => {
    frozen.set(true);
    message.set('Application en maintenance. Merci de patienter 10 minutes.');

    const promise = firstValueFrom(httpClient.put(`${BASE}/api/users`, { id: 'u-1' }));

    await expect(promise).rejects.toMatchObject({
      status: 503,
      error: {
        status: 503,
        title: 'Application en maintenance. Merci de patienter 10 minutes.'
      }
    });
    // La requête n'a jamais quitté le client.
    http.expectNone(`${BASE}/api/users`);
  });

  it('refuse aussi les lectures métier : l’interface est figée', async () => {
    frozen.set(true);

    await expect(
      firstValueFrom(httpClient.get(`${BASE}/api/users`))
    ).rejects.toMatchObject({ status: 503 });
    http.expectNone(`${BASE}/api/users`);
  });

  it('fournit un message de repli quand le serveur n’en a pas donné', async () => {
    frozen.set(true);
    message.set('');

    await expect(
      firstValueFrom(httpClient.get(`${BASE}/api/users`))
    ).rejects.toMatchObject({
      error: { title: 'Application en maintenance. Merci de patienter.' }
    });
  });

  it('laisse toujours passer le plan de contrôle de la maintenance', () => {
    frozen.set(true);

    // Sans cela l'application ne pourrait jamais apprendre la fin de la
    // maintenance, ni la lever.
    void firstValueFrom(httpClient.get(`${BASE}/api/Maintenance`));
    http.expectOne(`${BASE}/api/Maintenance`).flush({ isUnderMaintenance: true });

    void firstValueFrom(httpClient.post(`${BASE}/api/Maintenance/stop`, {}));
    http.expectOne(`${BASE}/api/Maintenance/stop`).flush({ isUnderMaintenance: false });
  });

  it('laisse passer la révocation mais bloque connexion et renouvellement', async () => {
    frozen.set(true);

    // La déconnexion forcée doit pouvoir révoquer le refresh token.
    void firstValueFrom(httpClient.post(`${BASE}/api/auth/revoke`, {}));
    http.expectOne(`${BASE}/api/auth/revoke`).flush(null);

    await expect(
      firstValueFrom(httpClient.post(`${BASE}/api/auth/login`, {}))
    ).rejects.toMatchObject({ status: 503 });
    http.expectNone(`${BASE}/api/auth/login`);

    await expect(
      firstValueFrom(httpClient.post(`${BASE}/api/auth/refresh`, {}))
    ).rejects.toMatchObject({ status: 503 });
    http.expectNone(`${BASE}/api/auth/refresh`);
  });

  it('laisse la fenêtre initiatrice renouveler son jeton même figée', () => {
    frozen.set(true);
    initiatedLocally.set(true);

    // Sa session est conservée pour lever la maintenance ; une expiration
    // d'access token la verrouillerait dehors.
    void firstValueFrom(httpClient.post(`${BASE}/api/auth/refresh`, {}));
    http.expectOne(`${BASE}/api/auth/refresh`).flush({});

    // Le reste demeure bloqué : elle est figée comme les autres.
    void expect(
      firstValueFrom(httpClient.get(`${BASE}/api/users`))
    ).rejects.toMatchObject({ status: 503 });
    http.expectNone(`${BASE}/api/users`);
  });

  it('ne rouvre pas la connexion à la fenêtre initiatrice', async () => {
    frozen.set(true);
    initiatedLocally.set(true);

    await expect(
      firstValueFrom(httpClient.post(`${BASE}/api/auth/login`, {}))
    ).rejects.toMatchObject({ status: 503 });
    http.expectNone(`${BASE}/api/auth/login`);
  });
});
