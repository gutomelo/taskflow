import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppShell } from './core/layout/app-shell';

@Component({
  selector: 'tf-root',
  imports: [AppShell, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <tf-app-shell>
      <router-outlet />
    </tf-app-shell>
  `,
})
export class App {}
