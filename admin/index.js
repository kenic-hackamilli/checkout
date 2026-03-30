const blessed = require('blessed');
const pool = require('../db');
const adminService = require('./adminService');
const {
  isValidExternalRequestId,
  normalizeExternalRequestId,
} = require('../utils/validation');

const VIEW_LABELS = {
  dashboard: 'Dashboard',
  failed: 'Failed Pushes',
  logs: 'Delivery Logs',
  registrars: 'Registrars',
};

const REGISTRAR_FORM_FIELDS = [
  {
    description: 'The registrar name used when requests are matched and displayed across the system.',
    key: 'name',
    label: 'Registrar Name',
    type: 'text',
  },
  {
    description: 'Optional registrar API endpoint used for automated push requests.',
    key: 'apiEndpoint',
    label: 'API Endpoint',
    type: 'text',
  },
  {
    description: 'Optional email that receives registrar-side registration notifications.',
    key: 'notificationEmail',
    label: 'Notification Email',
    type: 'text',
  },
  {
    description: 'Controls whether this registrar is available for active operational use.',
    key: 'isActive',
    label: 'Active Status',
    type: 'boolean',
  },
];

function toDisplay(value) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  return String(value);
}

function truncate(value, maxLength) {
  const text = toDisplay(value);

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function pad(value, width) {
  return truncate(value, width).padEnd(width, ' ');
}

function formatDateTime(value) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toISOString().replace('T', ' ').slice(0, 16);
}

function formatBoolean(value) {
  return value ? 'Yes' : 'No';
}

function getRegistrationLifecycleStatus(registration) {
  if (!registration) {
    return 'Unknown';
  }

  if (registration.pushed) {
    return 'Processed';
  }

  if (Number(registration.failed_push_count || 0) > 0) {
    return 'Failed Push';
  }

  if (registration.status === 'received') {
    return 'Incoming';
  }

  return registration.status || 'Incoming';
}

function formatJson(value) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
}

function createRegistrarDraft(existingRegistrar = null) {
  return {
    apiEndpoint: existingRegistrar ? existingRegistrar.api_endpoint || '' : '',
    isActive: existingRegistrar ? Boolean(existingRegistrar.is_active) : true,
    name: existingRegistrar ? existingRegistrar.name || '' : '',
    notificationEmail: existingRegistrar
      ? existingRegistrar.notification_email || ''
      : '',
  };
}

function formatRegistrarDraftValue(field, draft) {
  if (field.type === 'boolean') {
    return draft[field.key] ? 'Active' : 'Inactive';
  }

  const value = draft[field.key];
  return value ? String(value) : 'Not set';
}

function formatLookupDeliveryActivity(log) {
  return [
    `${formatDateTime(log.last_attempted_at || log.delivered_at || log.updated_at || log.created_at)}  ${log.delivery_type}/${log.recipient_type}  ${String(log.status || 'unknown').toUpperCase()}  attempts:${log.attempts}/${log.max_attempts}`,
    `  Destination: ${toDisplay(log.destination)}`,
    `  Template: ${toDisplay(log.template_key)}`,
    `  Subject: ${toDisplay(log.subject)}`,
    `  Provider Reference: ${toDisplay(log.provider_reference)}`,
    `  Delivered At: ${formatDateTime(log.delivered_at)}`,
    `  Last Error: ${toDisplay(log.last_error)}`,
  ].join('\n');
}

function formatLookupFailedPushAttempt(attempt) {
  return [
    `${formatDateTime(attempt.attempted_at)}`,
    `  ${toDisplay(attempt.error_message)}`,
  ].join('\n');
}

function buildRegistrationLookupContent(lookup) {
  const registration = lookup.registration;
  const deliveryTimeline = lookup.deliveryLogs.length
    ? lookup.deliveryLogs.map(formatLookupDeliveryActivity).join('\n\n ')
    : 'No delivery activity recorded yet.';
  const failedPushHistory = lookup.failedPushAttempts.length
    ? lookup.failedPushAttempts.map(formatLookupFailedPushAttempt).join('\n\n ')
    : 'No failed registrar pushes recorded.';

  return [
    '',
    ' Registration Summary',
    ` Public Reference: ${toDisplay(registration.external_request_id)}`,
    ` Internal Request ID: ${registration.request_id}`,
    ` Lifecycle Status: ${getRegistrationLifecycleStatus(registration)}`,
    ` Stored Status Field: ${toDisplay(registration.status)}`,
    ` Registrar Push Completed: ${formatBoolean(registration.pushed)}`,
    ` SMS Acknowledged: ${formatBoolean(registration.message_sent)}`,
    ` Registrar Reference ID: ${toDisplay(registration.registrar_reference_id)}`,
    ` Created At: ${formatDateTime(registration.created_at)}`,
    ` Updated At: ${formatDateTime(registration.updated_at)}`,
    '',
    ' Customer',
    ` Full Name: ${registration.full_name}`,
    ` Email: ${toDisplay(registration.email)}`,
    ` Phone: ${toDisplay(registration.phone)}`,
    '',
    ' Domain And Registrar',
    ` Domain: ${registration.domain_name}`,
    ` Chosen Registrar: ${toDisplay(registration.registrar_name)}`,
    ` Registrar Active: ${registration.registrar_is_active == null ? 'Unknown' : formatBoolean(registration.registrar_is_active)}`,
    ` Registrar Notification Email: ${toDisplay(registration.registrar_notification_email)}`,
    ` Registrar API Endpoint: ${toDisplay(registration.registrar_api_endpoint)}`,
    '',
    ' Delivery Summary',
    ` Successful Deliveries: ${registration.successful_delivery_count}`,
    ` Failed Deliveries: ${registration.failed_delivery_count}`,
    ` Pending Deliveries: ${registration.pending_delivery_count}`,
    ` Skipped Deliveries: ${registration.skipped_delivery_count}`,
    '',
    ' Registrar Push History',
    ` Failed Push Count: ${registration.failed_push_count}`,
    ` Last Failed At: ${formatDateTime(registration.last_failed_at)}`,
    ` Last Failure Message: ${toDisplay(registration.last_error_message)}`,
    '',
    ' Recent Delivery Timeline',
    ` ${deliveryTimeline}`,
    '',
    ' Failed Push Attempts',
    ` ${failedPushHistory}`,
  ].join('\n');
}

class AdminApp {
  constructor() {
    this.state = {
      dashboard: null,
      failedPushes: [],
      lastUpdated: null,
      logs: [],
      registrars: [],
      status: {
        message: 'Admin UI ready. Press Ctrl+R to refresh the current view.',
        type: 'info',
      },
      view: 'dashboard',
    };

    this.selectedIndices = {
      failed: 0,
      logs: 0,
      registrars: 0,
    };

    this.busy = false;
    this.modalActive = false;
    this.exiting = false;
  }

  async start() {
    if (!process.stdout.isTTY || !process.stdin.isTTY) {
      throw new Error('The admin UI requires an interactive terminal.');
    }

    this.createScreen();
    this.createLayout();
    this.bindKeys();

    await this.refreshCurrentView();
    this.screen.render();
  }

  createScreen() {
    this.screen = blessed.screen({
      dockBorders: true,
      fullUnicode: true,
      smartCSR: true,
      title: 'Checkout API Admin',
    });
  }

  createLayout() {
    this.header = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 2,
      padding: {
        left: 1,
        right: 1,
      },
      style: {
        bg: 'blue',
        fg: 'white',
      },
    });

    this.nav = blessed.listbar({
      parent: this.screen,
      top: 2,
      left: 0,
      width: '100%',
      height: 1,
      autoCommandKeys: false,
      mouse: true,
      keys: true,
      style: {
        bg: 'black',
        item: {
          bg: 'black',
          fg: 'white',
          hover: {
            bg: 'cyan',
            fg: 'black',
          },
        },
        selected: {
          bg: 'cyan',
          fg: 'black',
          bold: true,
        },
      },
      commands: {
        ' Dashboard (d) ': {
          callback: () => this.switchView('dashboard'),
        },
        ' Registrars (g) ': {
          callback: () => this.switchView('registrars'),
        },
        ' Failed (f) ': {
          callback: () => this.switchView('failed'),
        },
        ' Logs (l) ': {
          callback: () => this.switchView('logs'),
        },
      },
    });

    this.content = blessed.box({
      parent: this.screen,
      top: 3,
      left: 0,
      right: 0,
      bottom: 2,
      border: 'line',
      label: ' Main ',
      style: {
        border: {
          fg: 'cyan',
        },
      },
    });

    this.helpBar = blessed.box({
      parent: this.screen,
      left: 0,
      bottom: 1,
      width: '100%',
      height: 1,
      padding: {
        left: 1,
        right: 1,
      },
      style: {
        bg: 'black',
        fg: 'white',
      },
    });

    this.statusBar = blessed.box({
      parent: this.screen,
      left: 0,
      bottom: 0,
      width: '100%',
      height: 1,
      padding: {
        left: 1,
        right: 1,
      },
      style: {
        bg: 'blue',
        fg: 'white',
      },
    });

    this.question = blessed.question({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '70%',
      height: 5,
      border: 'line',
      label: ' Confirm ',
      style: {
        bg: 'black',
        fg: 'white',
        border: {
          fg: 'yellow',
        },
      },
    });

    this.question._.okay.style.bg = 'green';
    this.question._.okay.style.fg = 'black';
    this.question._.cancel.style.bg = 'red';
    this.question._.cancel.style.fg = 'white';

    this.loading = blessed.loading({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '50%',
      height: 5,
      border: 'line',
      align: 'center',
      style: {
        bg: 'black',
        fg: 'green',
        border: {
          fg: 'cyan',
        },
      },
    });

    this.updateChrome();
  }

  bindKeys() {
    this.screen.key(['C-c'], () => this.exit(0));

    this.screen.on('keypress', async (ch, key) => {
      if (this.modalActive) {
        return;
      }

      if (ch === 'Q') {
        await this.exit(0);
        return;
      }

      if (key.ctrl && key.name === 'r') {
        await this.refreshCurrentView();
        return;
      }

      if (ch === 'd') {
        await this.switchView('dashboard');
        return;
      }

      if (ch === 'g') {
        await this.switchView('registrars');
        return;
      }

      if (ch === 'f') {
        await this.switchView('failed');
        return;
      }

      if (ch === 'l') {
        await this.switchView('logs');
        return;
      }

      if (this.state.view === 'dashboard' && (ch === 's' || ch === '/')) {
        await this.searchRegistrationByExternalReference();
        return;
      }

      if (this.state.view === 'registrars') {
        if (ch === 'a') {
          await this.openRegistrarForm();
          return;
        }

        if (ch === 'e') {
          await this.editSelectedRegistrar();
          return;
        }

        if (ch === 't') {
          await this.toggleSelectedRegistrar();
        }
      }

      if (this.state.view === 'failed') {
        if (ch === 'r') {
          await this.retrySelectedFailedPush();
          return;
        }

        if (ch === 'R') {
          await this.retryAllFailedPushes();
        }
      }
    });

    this.screen.on('resize', () => {
      this.renderView();
      this.screen.render();
    });
  }

  async switchView(view) {
    if (this.state.view === view && !this.busy) {
      this.updateChrome();
      this.renderView();
      this.screen.render();
      return;
    }

    this.state.view = view;
    this.updateChrome();
    await this.refreshCurrentView();
  }

  setStatus(message, type = 'info') {
    this.state.status = { message, type };
    this.updateStatusBar();
  }

  updateChrome() {
    this.header.setContent(
      ` Checkout API Admin\n ${VIEW_LABELS[this.state.view]} | Last updated: ${formatDateTime(this.state.lastUpdated)}`
    );
    this.content.setLabel(` ${VIEW_LABELS[this.state.view]} `);
    this.updateHelpBar();
    this.updateStatusBar();
  }

  updateHelpBar() {
    const common = 'd dashboard | g registrars | f failed | l logs | Ctrl+R refresh | Q quit';
    const viewHelp = {
      dashboard: `${common} | s search reference`,
      failed: `${common} | r retry selected | R retry all`,
      logs: `${common} | arrows move`,
      registrars: `${common} | a add | e open editor | t toggle active`,
    };

    this.helpBar.setContent(` ${viewHelp[this.state.view]}`);
  }

  updateStatusBar() {
    const colors = {
      error: { bg: 'red', fg: 'white' },
      info: { bg: 'blue', fg: 'white' },
      success: { bg: 'green', fg: 'black' },
      warning: { bg: 'yellow', fg: 'black' },
    };

    const style = colors[this.state.status.type] || colors.info;
    this.statusBar.style.bg = style.bg;
    this.statusBar.style.fg = style.fg;
    this.statusBar.setContent(` ${this.state.status.message}`);
  }

  clearContent() {
    this.content.children.slice().forEach((child) => child.detach());
  }

  async withLoading(message, action) {
    if (this.busy) {
      return null;
    }

    this.busy = true;
    this.loading.load(message);

    try {
      return await action();
    } catch (error) {
      this.setStatus(error.message, 'error');
      return null;
    } finally {
      this.loading.stop();
      this.busy = false;
      this.screen.render();
    }
  }

  async refreshCurrentView() {
    return this.withLoading(`Loading ${VIEW_LABELS[this.state.view]}...`, async () => {
      try {
        if (this.state.view === 'dashboard') {
          this.state.dashboard = await adminService.getDashboardData();
        } else if (this.state.view === 'registrars') {
          this.state.registrars = await adminService.listRegistrars();
        } else if (this.state.view === 'failed') {
          this.state.failedPushes = await adminService.listFailedPushes();
        } else if (this.state.view === 'logs') {
          this.state.logs = await adminService.listRecentDeliveryLogs();
        }

        this.state.lastUpdated = new Date();
        this.updateChrome();
        this.renderView();
        this.setStatus(`${VIEW_LABELS[this.state.view]} refreshed successfully.`, 'success');
      } catch (error) {
        this.setStatus(error.message, 'error');
      }
    });
  }

  createPanel(options) {
    return blessed.box({
      parent: this.content,
      border: 'line',
      scrollable: Boolean(options.scrollable),
      alwaysScroll: Boolean(options.scrollable),
      keys: Boolean(options.scrollable),
      mouse: true,
      label: options.label,
      top: options.top,
      left: options.left,
      width: options.width,
      height: options.height,
      bottom: options.bottom,
      right: options.right,
      style: {
        border: {
          fg: options.borderColor || 'white',
        },
      },
    });
  }

  renderView() {
    this.clearContent();

    if (this.state.view === 'dashboard') {
      this.renderDashboardView();
      return;
    }

    if (this.state.view === 'registrars') {
      this.renderRegistrarsView();
      return;
    }

    if (this.state.view === 'failed') {
      this.renderFailedPushesView();
      return;
    }

    this.renderLogsView();
  }

  renderDashboardView() {
    const dashboard = this.state.dashboard;

    if (!dashboard) {
      this.renderEmptyState('No dashboard data loaded yet.');
      return;
    }

    const statItems = [
      { label: 'Incoming', shortLabel: 'Incoming', value: dashboard.stats.incoming_count, color: 'yellow' },
      { label: 'Processed', shortLabel: 'Processed', value: dashboard.stats.processed_count, color: 'green' },
      { label: 'Failed Pushes', shortLabel: 'Failed', value: dashboard.stats.failed_push_count, color: 'red' },
      { label: 'Active Registrars', shortLabel: 'Active', value: dashboard.stats.active_registrar_count, color: 'blue' },
      { label: 'Delivery Failures', shortLabel: 'Deliveries', value: dashboard.stats.failed_delivery_count, color: 'magenta' },
    ];

    const screenWidth = this.screen.width || 120;
    const statColumns = screenWidth < 100 ? 2 : screenWidth < 140 ? 3 : 5;
    const statLabelKey = screenWidth < 100 ? 'shortLabel' : 'label';
    const statHeight = 5;
    const statRows = Math.ceil(statItems.length / statColumns);
    const statWidth = `${100 / statColumns}%`;

    statItems.forEach((item, index) => {
      const row = Math.floor(index / statColumns);
      const column = index % statColumns;

      const panel = this.createPanel({
        label: ` ${item[statLabelKey]} `,
        top: row * statHeight,
        left: `${column * (100 / statColumns)}%`,
        width: statWidth,
        height: statHeight,
        borderColor: item.color,
      });

      blessed.box({
        parent: panel,
        top: 1,
        left: 0,
        width: '100%',
        height: 2,
        align: 'center',
        valign: 'middle',
        content: `${item.value}`,
        style: {
          fg: item.color,
          bold: true,
        },
      });
    });

    const failedPanel = this.createPanel({
      label: ' Latest Failed Pushes ',
      top: statRows * statHeight,
      left: 0,
      width: '50%',
      bottom: 0,
      borderColor: 'red',
      scrollable: true,
    });

    const registrarPanel = this.createPanel({
      label: ' Active Registrars ',
      top: statRows * statHeight,
      left: '50%',
      width: '50%',
      bottom: 0,
      borderColor: 'green',
      scrollable: true,
    });

    const failedLines = dashboard.failedPushes.length
      ? dashboard.failedPushes.map(
          (item) =>
            `${formatDateTime(item.attempted_at)}  ${truncate(item.domain_name, 18)}  ${truncate(item.registrar_name, 16)}\n${truncate(item.error_message, 72)}`
        )
      : ['No failed pushes right now.'];

    const activeRegistrars = dashboard.registrars.filter((registrar) => registrar.is_active);
    const registrarLines = activeRegistrars.length
      ? activeRegistrars.slice(0, 10).map(
          (registrar) =>
            `${truncate(registrar.name, 24)}  requests:${registrar.total_requests}  processed:${registrar.processed_requests}\nemail:${toDisplay(registrar.notification_email)}`
        )
      : ['No active registrars configured yet.'];

    failedPanel.setContent(`\n ${failedLines.join('\n\n ')}`);
    registrarPanel.setContent(`\n ${registrarLines.join('\n\n ')}`);
  }

  renderRegistrarsView() {
    const registrars = this.state.registrars || [];

    const listPanel = this.createPanel({
      label: ' Registrar List ',
      top: 0,
      left: 0,
      width: '64%',
      bottom: 0,
      borderColor: 'cyan',
    });

    const detailsPanel = this.createPanel({
      label: ' Registrar Details ',
      top: 0,
      left: '64%',
      width: '36%',
      bottom: 0,
      borderColor: 'green',
      scrollable: true,
    });

    blessed.box({
      parent: listPanel,
      top: 0,
      left: 1,
      right: 1,
      height: 1,
      content: `${pad('Name', 22)} ${pad('Status', 10)} ${pad('Email', 22)} ${pad('API', 10)} ${pad('Requests', 8)}`,
      style: {
        bold: true,
        fg: 'white',
      },
    });

    const list = blessed.list({
      parent: listPanel,
      top: 1,
      left: 0,
      right: 0,
      bottom: 0,
      keys: true,
      vi: true,
      mouse: true,
      scrollbar: {
        ch: ' ',
        style: {
          bg: 'cyan',
        },
      },
      style: {
        selected: {
          bg: 'cyan',
          fg: 'black',
          bold: true,
        },
      },
      items: registrars.length
        ? registrars.map(
            (registrar) =>
              `${pad(registrar.name, 22)} ${pad(registrar.is_active ? 'ACTIVE' : 'INACTIVE', 10)} ${pad(registrar.notification_email || '—', 22)} ${pad(registrar.api_endpoint ? 'CONFIGURED' : '—', 10)} ${pad(registrar.total_requests, 8)}`
          )
        : ['No registrars found. Press "a" to add one.'],
    });

    const selectedIndex = this.getClampedSelectedIndex('registrars', registrars.length);
    this.selectedIndices.registrars = selectedIndex;

    const renderDetails = (index) => {
      if (!registrars.length) {
        detailsPanel.setContent('\n No registrar selected yet.\n\n Press "a" to add your first registrar.');
        return;
      }

      const registrar = registrars[index];

      detailsPanel.setContent(
        [
          '',
          ` Name: ${registrar.name}`,
          ` Active: ${formatBoolean(registrar.is_active)}`,
          ` Notification Email: ${toDisplay(registrar.notification_email)}`,
          ` API Endpoint: ${toDisplay(registrar.api_endpoint)}`,
          ` Total Requests: ${registrar.total_requests}`,
          ` Processed Requests: ${registrar.processed_requests}`,
          ` Created At: ${formatDateTime(registrar.created_at)}`,
          '',
          ' Actions:',
          '  a  Add registrar',
          '  e  Open registrar editor',
          '  t  Toggle active / inactive',
        ].join('\n')
      );
    };

    list.on('select item', (_, index) => {
      this.selectedIndices.registrars = index;
      renderDetails(index);
      this.screen.render();
    });

    if (registrars.length) {
      list.select(selectedIndex);
      renderDetails(selectedIndex);
      list.focus();
    } else {
      renderDetails(0);
    }
  }

  renderFailedPushesView() {
    const failedPushes = this.state.failedPushes || [];

    const listPanel = this.createPanel({
      label: ' Failed Registrar Pushes ',
      top: 0,
      left: 0,
      width: '64%',
      bottom: 0,
      borderColor: 'red',
    });

    const detailsPanel = this.createPanel({
      label: ' Failure Details ',
      top: 0,
      left: '64%',
      width: '36%',
      bottom: 0,
      borderColor: 'yellow',
      scrollable: true,
    });

    blessed.box({
      parent: listPanel,
      top: 0,
      left: 1,
      right: 1,
      height: 1,
      content: `${pad('Domain', 22)} ${pad('Registrar', 18)} ${pad('Attempted', 17)} ${pad('Pushed', 8)}`,
      style: {
        bold: true,
        fg: 'white',
      },
    });

    const list = blessed.list({
      parent: listPanel,
      top: 1,
      left: 0,
      right: 0,
      bottom: 0,
      keys: true,
      vi: true,
      mouse: true,
      scrollbar: {
        ch: ' ',
        style: {
          bg: 'red',
        },
      },
      style: {
        selected: {
          bg: 'red',
          fg: 'white',
          bold: true,
        },
      },
      items: failedPushes.length
        ? failedPushes.map(
            (item) =>
              `${pad(item.domain_name, 22)} ${pad(item.registrar_name, 18)} ${pad(formatDateTime(item.attempted_at), 17)} ${pad(item.pushed ? 'YES' : 'NO', 8)}`
          )
        : ['No failed pushes found.'],
    });

    const selectedIndex = this.getClampedSelectedIndex('failed', failedPushes.length);
    this.selectedIndices.failed = selectedIndex;

    const renderDetails = (index) => {
      if (!failedPushes.length) {
        detailsPanel.setContent('\n No failed pushes available.\n\n Press Ctrl+R to refresh this view later.');
        return;
      }

      const failedPush = failedPushes[index];

      detailsPanel.setContent(
        [
          '',
          ` Request ID: ${failedPush.registration_id}`,
          ` Public Reference: ${toDisplay(failedPush.external_request_id)}`,
          ` Domain: ${failedPush.domain_name}`,
          ` Registrar: ${failedPush.registrar_name}`,
          ` Customer: ${failedPush.full_name}`,
          ` Email: ${toDisplay(failedPush.email)}`,
          ` Phone: ${toDisplay(failedPush.phone)}`,
          ` Registration Created: ${formatDateTime(failedPush.created_at)}`,
          ` Last Failed At: ${formatDateTime(failedPush.attempted_at)}`,
          ` Pushed: ${formatBoolean(failedPush.pushed)}`,
          ` Registrar Reference: ${toDisplay(failedPush.registrar_reference_id)}`,
          '',
          ' Last Error:',
          ` ${toDisplay(failedPush.error_message)}`,
          '',
          ' Actions:',
          '  r  Retry selected failed push',
          '  R  Retry all failed pushes',
        ].join('\n')
      );
    };

    list.on('select item', (_, index) => {
      this.selectedIndices.failed = index;
      renderDetails(index);
      this.screen.render();
    });

    if (failedPushes.length) {
      list.select(selectedIndex);
      renderDetails(selectedIndex);
      list.focus();
    } else {
      renderDetails(0);
    }
  }

  renderLogsView() {
    const logs = this.state.logs || [];

    const listPanel = this.createPanel({
      label: ' Recent Delivery Logs ',
      top: 0,
      left: 0,
      width: '64%',
      bottom: 0,
      borderColor: 'magenta',
    });

    const detailsPanel = this.createPanel({
      label: ' Delivery Log Details ',
      top: 0,
      left: '64%',
      width: '36%',
      bottom: 0,
      borderColor: 'blue',
      scrollable: true,
    });

    blessed.box({
      parent: listPanel,
      top: 0,
      left: 1,
      right: 1,
      height: 1,
      content: `${pad('When', 17)} ${pad('Type', 14)} ${pad('Recipient', 10)} ${pad('Status', 10)} ${pad('Domain', 18)}`,
      style: {
        bold: true,
        fg: 'white',
      },
    });

    const list = blessed.list({
      parent: listPanel,
      top: 1,
      left: 0,
      right: 0,
      bottom: 0,
      keys: true,
      vi: true,
      mouse: true,
      scrollbar: {
        ch: ' ',
        style: {
          bg: 'magenta',
        },
      },
      style: {
        selected: {
          bg: 'magenta',
          fg: 'white',
          bold: true,
        },
      },
      items: logs.length
        ? logs.map(
            (log) =>
              `${pad(formatDateTime(log.last_attempted_at || log.updated_at || log.created_at), 17)} ${pad(log.delivery_type, 14)} ${pad(log.recipient_type, 10)} ${pad(log.status.toUpperCase(), 10)} ${pad(log.domain_name || '—', 18)}`
          )
        : ['No delivery logs found.'],
    });

    const selectedIndex = this.getClampedSelectedIndex('logs', logs.length);
    this.selectedIndices.logs = selectedIndex;

    const renderDetails = (index) => {
      if (!logs.length) {
        detailsPanel.setContent('\n No delivery log selected.');
        return;
      }

      const log = logs[index];

      detailsPanel.setContent(
        [
          '',
          ` Registration ID: ${log.registration_id}`,
          ` Public Reference: ${toDisplay(log.external_request_id)}`,
          ` Domain: ${toDisplay(log.domain_name)}`,
          ` Registrar: ${toDisplay(log.registrar_name)}`,
          ` Type: ${log.delivery_type}`,
          ` Recipient: ${log.recipient_type}`,
          ` Destination: ${toDisplay(log.destination)}`,
          ` Subject: ${toDisplay(log.subject)}`,
          ` Status: ${log.status}`,
          ` Attempts: ${log.attempts} / ${log.max_attempts}`,
          ` Provider Reference: ${toDisplay(log.provider_reference)}`,
          ` First Attempt: ${formatDateTime(log.first_attempted_at)}`,
          ` Last Attempt: ${formatDateTime(log.last_attempted_at)}`,
          ` Delivered At: ${formatDateTime(log.delivered_at)}`,
          '',
          ' Payload:',
          `${formatJson(log.payload)}`,
          '',
          ' Last Response:',
          `${formatJson(log.last_response)}`,
          '',
          ' Last Error:',
          `${formatJson(log.last_error)}`,
        ].join('\n')
      );
    };

    list.on('select item', (_, index) => {
      this.selectedIndices.logs = index;
      renderDetails(index);
      this.screen.render();
    });

    if (logs.length) {
      list.select(selectedIndex);
      renderDetails(selectedIndex);
      list.focus();
    } else {
      renderDetails(0);
    }
  }

  renderEmptyState(message) {
    blessed.box({
      parent: this.content,
      top: 'center',
      left: 'center',
      width: '80%',
      height: 5,
      align: 'center',
      valign: 'middle',
      content: message,
      style: {
        fg: 'white',
      },
    });
  }

  getClampedSelectedIndex(viewKey, itemCount) {
    if (!itemCount) {
      return 0;
    }

    const selectedIndex = this.selectedIndices[viewKey] || 0;
    return Math.max(0, Math.min(selectedIndex, itemCount - 1));
  }

  async askConfirmation(question) {
    this.modalActive = true;

    try {
      return await new Promise((resolve, reject) => {
        this.question.ask(question, (error, accepted) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(Boolean(accepted));
        });
      });
    } finally {
      this.modalActive = false;
      this.screen.render();
    }
  }

  getSelectedRegistrar() {
    const registrars = this.state.registrars || [];

    if (!registrars.length) {
      return null;
    }

    return registrars[this.getClampedSelectedIndex('registrars', registrars.length)];
  }

  getSelectedFailedPush() {
    const failedPushes = this.state.failedPushes || [];

    if (!failedPushes.length) {
      return null;
    }

    return failedPushes[this.getClampedSelectedIndex('failed', failedPushes.length)];
  }

  async openExternalReferenceLookupPrompt() {
    return new Promise((resolve) => {
      const modal = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '76%',
        height: 13,
        border: 'line',
        label: ' Search Registration By Public Reference ',
        style: {
          bg: 'black',
          fg: 'white',
          border: {
            fg: 'cyan',
          },
        },
      });

      blessed.box({
        parent: modal,
        top: 1,
        left: 2,
        right: 2,
        height: 3,
        content: 'Enter the public reference from the API response or email. Legacy 8-digit references and the newer 10-character letter-number codes are both supported.',
        style: {
          fg: 'white',
        },
      });

      const input = blessed.textbox({
        parent: modal,
        top: 6,
        left: 2,
        right: 2,
        height: 3,
        inputOnFocus: false,
        keys: true,
        mouse: true,
        border: 'line',
        value: '',
        style: {
          bg: 'white',
          fg: 'black',
          border: {
            fg: 'green',
          },
          focus: {
            bg: 'white',
            fg: 'black',
          },
        },
      });

      blessed.box({
        parent: modal,
        bottom: 0,
        left: 2,
        right: 2,
        height: 1,
        content: ' Type in the white box. Press Enter to search or Esc to cancel.',
        style: {
          fg: 'green',
        },
      });

      this.screen.saveFocus();
      input.focus();
      input.setValue('');
      this.screen.render();

      input.readInput((error, result) => {
        modal.detach();
        this.screen.restoreFocus();
        this.screen.render();

        if (error || result === null) {
          resolve(null);
          return;
        }

        resolve(normalizeExternalRequestId(result));
      });
    });
  }

  async openRegistrationLookupResult(lookup) {
    return new Promise((resolve) => {
      const reference = lookup.registration.external_request_id || 'Lookup Result';
      const modal = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '92%',
        height: '88%',
        border: 'line',
        label: ` Registration Lookup: ${reference} `,
        style: {
          bg: 'black',
          fg: 'white',
          border: {
            fg: 'cyan',
          },
        },
      });

      const details = blessed.box({
        parent: modal,
        top: 0,
        left: 0,
        right: 0,
        bottom: 2,
        scrollable: true,
        alwaysScroll: true,
        keys: true,
        vi: true,
        mouse: true,
        scrollbar: {
          ch: ' ',
          style: {
            bg: 'cyan',
          },
        },
        content: buildRegistrationLookupContent(lookup),
        style: {
          fg: 'white',
        },
      });

      blessed.box({
        parent: modal,
        bottom: 0,
        left: 2,
        right: 2,
        height: 1,
        content: ' Up/Down scroll | PgUp/PgDn move | x close ',
        style: {
          fg: 'green',
        },
      });

      const close = () => {
        modal.detach();
        this.screen.restoreFocus();
        this.screen.render();
        resolve();
      };

      modal.key(['escape', 'x'], () => close());
      details.key(['escape', 'x'], () => close());

      this.screen.saveFocus();
      details.focus();
      details.setScroll(0);
      this.screen.render();
    });
  }

  async searchRegistrationByExternalReference() {
    this.modalActive = true;

    try {
      const externalReference = await this.openExternalReferenceLookupPrompt();

      if (!externalReference) {
        this.setStatus('Reference lookup cancelled.', 'warning');
        return;
      }

      if (!isValidExternalRequestId(externalReference)) {
        this.setStatus(
          'Enter a valid public reference from the confirmation email or API response.',
          'warning'
        );
        return;
      }

      const lookup = await this.withLoading(
        `Searching public reference ${externalReference}...`,
        async () => {
          const lookupResult = await adminService.getRegistrationByExternalReference(
            externalReference
          );

          return lookupResult || { notFound: true };
        }
      );

      if (!lookup) {
        return;
      }

      if (lookup.notFound) {
        this.setStatus(
          `No registration was found for public reference ${externalReference}.`,
          'warning'
        );
        return;
      }

      this.setStatus(
        `Loaded registration ${externalReference}. Press x to close the lookup.`,
        'success'
      );
      await this.openRegistrationLookupResult(lookup);
    } catch (error) {
      this.setStatus(error.message, 'error');
    } finally {
      this.modalActive = false;
      this.screen.render();
    }
  }

  async openTextFieldEditor(field, currentValue) {
    const editorValue = currentValue == null ? '' : String(currentValue);

    return new Promise((resolve) => {
      const modal = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '76%',
        height: 13,
        border: 'line',
        label: ` Edit ${field.label} `,
        tags: true,
        style: {
          bg: 'black',
          fg: 'white',
          border: {
            fg: 'green',
          },
        },
      });

      blessed.box({
        parent: modal,
        top: 1,
        left: 2,
        right: 2,
        height: 3,
        tags: true,
        content: `{bold}${field.label}{/bold}\n${field.description}`,
        style: {
          fg: 'white',
        },
      });

      const currentValueBox = blessed.box({
        parent: modal,
        top: 4,
        left: 2,
        right: 2,
        height: 2,
        tags: true,
        content: `{bold}Current Value:{/bold} ${editorValue || 'Not set'}`,
        style: {
          fg: 'yellow',
        },
      });

      const input = blessed.textbox({
        parent: modal,
        top: 7,
        left: 2,
        right: 2,
        height: 3,
        inputOnFocus: false,
        keys: true,
        mouse: true,
        border: 'line',
        value: editorValue,
        style: {
          bg: 'white',
          fg: 'black',
          border: {
            fg: 'green',
          },
          focus: {
            bg: 'white',
            fg: 'black',
          },
        },
      });

      blessed.box({
        parent: modal,
        bottom: 0,
        left: 2,
        right: 2,
        height: 1,
        content: ' Type in the white box. Press Enter to save this field or Esc to cancel.',
        style: {
          fg: 'green',
        },
      });

      this.screen.saveFocus();
      input.focus();
      input.setValue(editorValue);
      this.screen.render();

      input.readInput((error, result) => {
        currentValueBox.detach();
        modal.detach();
        this.screen.restoreFocus();
        this.screen.render();

        if (error || result === null) {
          resolve(null);
          return;
        }

        resolve(result);
      });
    });
  }

  async openBooleanFieldEditor(field, currentValue) {
    return new Promise((resolve) => {
      const modal = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '62%',
        height: 12,
        border: 'line',
        label: ` Edit ${field.label} `,
        tags: true,
        style: {
          bg: 'black',
          fg: 'white',
          border: {
            fg: 'yellow',
          },
        },
      });

      blessed.box({
        parent: modal,
        top: 1,
        left: 2,
        right: 2,
        height: 3,
        tags: true,
        content: `{bold}${field.label}{/bold}\n${field.description}`,
        style: {
          fg: 'white',
        },
      });

      const options = [
        { label: 'Active', value: true },
        { label: 'Inactive', value: false },
      ];

      const list = blessed.list({
        parent: modal,
        top: 5,
        left: 2,
        right: 2,
        height: 3,
        keys: true,
        mouse: true,
        style: {
          selected: {
            bg: 'green',
            fg: 'black',
            bold: true,
          },
        },
        items: options.map((option) => option.label),
      });

      blessed.box({
        parent: modal,
        bottom: 0,
        left: 2,
        right: 2,
        height: 1,
        content: ' Use arrows to choose. Press Enter to save or x / Esc to cancel.',
        style: {
          fg: 'green',
        },
      });

      const done = (value) => {
        modal.detach();
        this.screen.restoreFocus();
        this.screen.render();
        resolve(value);
      };

      modal.key(['escape', 'x'], () => done(null));
      list.key(['enter'], () => {
        const selected = options[list.selected] || options[0];
        done(selected.value);
      });

      this.screen.saveFocus();
      list.focus();
      list.select(options.findIndex((option) => option.value === currentValue) >= 0
        ? options.findIndex((option) => option.value === currentValue)
        : 0);
      this.screen.render();
    });
  }

  async openRegistrarForm(existingRegistrar = null) {
    this.modalActive = true;

    try {
      const draft = createRegistrarDraft(existingRegistrar);
      const formTitle = existingRegistrar
        ? ` Edit Registrar: ${existingRegistrar.name} `
        : ' Add Registrar ';

      const result = await new Promise((resolve) => {
        const modal = blessed.box({
          parent: this.screen,
          top: 'center',
          left: 'center',
          width: '88%',
          height: '80%',
          border: 'line',
          label: formTitle,
          style: {
            bg: 'black',
            fg: 'white',
            border: {
              fg: 'cyan',
            },
          },
        });

        const fieldsPanel = blessed.box({
          parent: modal,
          top: 0,
          left: 0,
          width: '44%',
          bottom: 3,
          border: 'line',
          label: ' Fields ',
          style: {
            border: {
              fg: 'green',
            },
          },
        });

        const detailsPanel = blessed.box({
          parent: modal,
          top: 0,
          left: '44%',
          width: '56%',
          bottom: 3,
          border: 'line',
          label: ' Field Details ',
          scrollable: true,
          style: {
            border: {
              fg: 'yellow',
            },
          },
        });

        blessed.box({
          parent: modal,
          left: 2,
          right: 2,
          bottom: 0,
          height: 2,
          content: ' Enter edit selected field | s save registrar | x close | Esc cancel | Up/Down move between fields ',
          style: {
            fg: 'green',
          },
        });

        const fieldList = blessed.list({
          parent: fieldsPanel,
          top: 1,
          left: 0,
          right: 0,
          bottom: 0,
          keys: true,
          vi: true,
          mouse: true,
          style: {
            selected: {
              bg: 'cyan',
              fg: 'black',
              bold: true,
            },
          },
          items: [],
        });

        const cleanup = (value) => {
          modal.detach();
          this.screen.restoreFocus();
          this.screen.render();
          resolve(value);
        };

        const renderFieldList = () => {
          fieldList.setItems(
            REGISTRAR_FORM_FIELDS.map(
              (field) =>
                `${pad(field.label, 20)} ${truncate(formatRegistrarDraftValue(field, draft), 24)}`
            )
          );
        };

        const renderFieldDetails = (selectedIndex) => {
          const field = REGISTRAR_FORM_FIELDS[selectedIndex] || REGISTRAR_FORM_FIELDS[0];

          detailsPanel.setContent(
            [
              '',
              ` Field: ${field.label}`,
              '',
              ` Current Value: ${formatRegistrarDraftValue(field, draft)}`,
              '',
              ` Description: ${field.description}`,
              '',
              ' Editing Flow:',
              '  1. Move to the field you want.',
              '  2. Press Enter to edit only that field.',
              '  3. Press s when the full registrar draft looks right.',
              '',
              ' Draft Preview:',
              `  Name: ${draft.name || 'Not set'}`,
              `  API Endpoint: ${draft.apiEndpoint || 'Not set'}`,
              `  Notification Email: ${draft.notificationEmail || 'Not set'}`,
              `  Active: ${draft.isActive ? 'Active' : 'Inactive'}`,
            ].join('\n')
          );
        };

        const editSelectedField = async () => {
          const selectedIndex = fieldList.selected || 0;
          const field = REGISTRAR_FORM_FIELDS[selectedIndex];

          if (field.type === 'boolean') {
            const nextValue = await this.openBooleanFieldEditor(
              field,
              draft[field.key]
            );

            if (nextValue !== null) {
              draft[field.key] = nextValue;
            }
          } else {
            const nextValue = await this.openTextFieldEditor(
              field,
              draft[field.key]
            );

            if (nextValue !== null) {
              draft[field.key] = nextValue.trim();
            }
          }

          renderFieldList();
          fieldList.select(selectedIndex);
          renderFieldDetails(selectedIndex);
          fieldList.focus();
          this.screen.render();
        };

        modal.key(['escape', 'x'], () => cleanup(null));
        modal.key(['s'], () => cleanup({ ...draft }));
        fieldList.key(['escape', 'x'], () => cleanup(null));
        fieldList.key(['s'], () => cleanup({ ...draft }));
        fieldList.key(['enter'], async () => {
          await editSelectedField();
        });

        fieldList.on('select item', (_, index) => {
          renderFieldDetails(index);
          this.screen.render();
        });

        this.screen.saveFocus();
        renderFieldList();
        renderFieldDetails(0);
        fieldList.focus();
        fieldList.select(0);
        this.screen.render();
      });

      if (!result) {
        this.setStatus('Registrar edit cancelled.', 'warning');
        return;
      }

      const payload = {
        apiEndpoint: result.apiEndpoint,
        isActive: result.isActive,
        name: result.name,
        notificationEmail: result.notificationEmail,
      };

      await this.withLoading(
        existingRegistrar ? 'Updating registrar...' : 'Creating registrar...',
        async () => {
          if (existingRegistrar) {
            await adminService.updateRegistrar(existingRegistrar.id, payload);
            this.setStatus(`Registrar "${payload.name}" updated successfully.`, 'success');
          } else {
            await adminService.createRegistrar(payload);
            this.setStatus(`Registrar "${payload.name}" created successfully.`, 'success');
          }

          this.state.view = 'registrars';
          this.updateChrome();
          this.state.registrars = await adminService.listRegistrars();
          this.renderView();
        }
      );
    } catch (error) {
      this.setStatus(error.message, 'error');
    } finally {
      this.modalActive = false;
      this.screen.render();
    }
  }

  async editSelectedRegistrar() {
    const registrar = this.getSelectedRegistrar();

    if (!registrar) {
      this.setStatus('Select a registrar to edit first.', 'warning');
      return;
    }

    await this.openRegistrarForm(registrar);
  }

  async toggleSelectedRegistrar() {
    const registrar = this.getSelectedRegistrar();

    if (!registrar) {
      this.setStatus('Select a registrar first.', 'warning');
      return;
    }

    const confirmed = await this.askConfirmation(
      `Toggle "${registrar.name}" to ${registrar.is_active ? 'inactive' : 'active'}?`
    );

    if (!confirmed) {
      this.setStatus('Registrar toggle cancelled.', 'warning');
      return;
    }

    await this.withLoading('Updating registrar status...', async () => {
      await adminService.toggleRegistrarActive(registrar.id);
      this.state.registrars = await adminService.listRegistrars();
      this.renderView();
      this.setStatus(`Registrar "${registrar.name}" status updated.`, 'success');
    });
  }

  async retrySelectedFailedPush() {
    const failedPush = this.getSelectedFailedPush();

    if (!failedPush) {
      this.setStatus('There is no failed push selected.', 'warning');
      return;
    }

    await this.withLoading('Retrying selected failed push...', async () => {
      const result = await adminService.retryFailedPush(failedPush.registration_id);
      this.state.failedPushes = await adminService.listFailedPushes();
      this.renderView();

      if (result.status === 'success') {
        this.setStatus(
          `Retry succeeded for ${failedPush.domain_name}.`,
          'success'
        );
        return;
      }

      this.setStatus(
        `Retry finished with status "${result.status}" for ${failedPush.domain_name}.`,
        result.status === 'failed' ? 'error' : 'warning'
      );
    });
  }

  async retryAllFailedPushes() {
    const failedPushes = this.state.failedPushes || [];

    if (!failedPushes.length) {
      this.setStatus('There are no failed pushes to retry.', 'warning');
      return;
    }

    const confirmed = await this.askConfirmation(
      `Retry all ${failedPushes.length} failed registrar pushes?`
    );

    if (!confirmed) {
      this.setStatus('Retry all cancelled.', 'warning');
      return;
    }

    await this.withLoading('Retrying all failed pushes...', async () => {
      const summary = await adminService.retryAllFailedPushes();
      this.state.failedPushes = await adminService.listFailedPushes();
      this.renderView();
      this.setStatus(
        `Retried ${summary.retried} failed pushes. ${summary.succeeded} succeeded.`,
        summary.succeeded > 0 ? 'success' : 'warning'
      );
    });
  }

  async exit(code = 0) {
    if (this.exiting) {
      return;
    }

    this.exiting = true;

    try {
      if (this.screen) {
        this.screen.destroy();
      }
    } catch (error) {
      // Best-effort cleanup before exiting.
    }

    try {
      await pool.end();
    } finally {
      process.exit(code);
    }
  }
}

async function main() {
  const app = new AdminApp();

  process.on('uncaughtException', async (error) => {
    if (app.screen) {
      app.screen.destroy();
    }

    console.error('Admin UI crashed:', error);
    await pool.end();
    process.exit(1);
  });

  process.on('unhandledRejection', async (error) => {
    if (app.screen) {
      app.screen.destroy();
    }

    console.error('Unhandled admin UI rejection:', error);
    await pool.end();
    process.exit(1);
  });

  await app.start();
}

main().catch(async (error) => {
  console.error('Failed to start admin UI:', error);
  await pool.end();
  process.exit(1);
});
