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
const REGISTRAR_DELETE_CONFIRMATION_PHRASE = 'DELETE NOW';

const REGISTRAR_FORM_FIELDS = [
  {
    description: 'Required. The registrar name used when requests are matched and displayed across the system.',
    key: 'name',
    label: 'Registrar Name',
    type: 'text',
  },
  {
    description: 'Required. Primary registrar contact email used for portal access and operational communication.',
    key: 'primaryEmail',
    label: 'Primary Email',
    type: 'text',
  },
  {
    description: 'Required. Primary registrar contact phone used for portal OTP verification.',
    key: 'primaryPhone',
    label: 'Primary Phone',
    type: 'text',
  },
  {
    description: 'Required. Registrar API endpoint used for automated push requests.',
    key: 'apiEndpoint',
    label: 'API Endpoint',
    type: 'text',
  },
  {
    description: 'Required. Email that receives registrar-side registration notifications.',
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

function formatCurrencyKsh(value) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return String(value);
  }

  return `KSh ${numericValue.toLocaleString('en-KE')}`;
}

function formatBillingLabel(billingCycle, billingPeriodMonths) {
  const normalizedCycle = typeof billingCycle === 'string' ? billingCycle.toLowerCase() : '';
  const normalizedMonths = Number(billingPeriodMonths);

  if (normalizedCycle === 'monthly' || normalizedMonths === 1) {
    return 'Monthly';
  }

  if (normalizedCycle === 'yearly' || normalizedMonths === 12) {
    return 'Yearly';
  }

  if (Number.isFinite(normalizedMonths) && normalizedMonths > 0) {
    return `${normalizedMonths} months`;
  }

  return 'Flexible';
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

function normalizeLookupText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseRegistrationSelectionSnapshot(value) {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      const parsedValue = JSON.parse(value);
      return parsedValue && typeof parsedValue === 'object' && !Array.isArray(parsedValue)
        ? parsedValue
        : {};
    } catch (_error) {
      return {};
    }
  }

  return typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function humanizeLookupLabel(value) {
  const normalizedValue = normalizeLookupText(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();

  if (!normalizedValue) {
    return '';
  }

  return normalizedValue
    .split(' ')
    .map((token) => {
      if (token === 'wordpress') {
        return 'WordPress';
      }

      if (token === 'api') {
        return 'API';
      }

      if (token === 'sms') {
        return 'SMS';
      }

      if (token === 'kyc') {
        return 'KYC';
      }

      return `${token.charAt(0).toUpperCase()}${token.slice(1)}`;
    })
    .join(' ');
}

function buildRegistrationSelectionSummary(registration) {
  const snapshot = parseRegistrationSelectionSnapshot(
    registration && registration.selection_snapshot_json
  );
  const selectionKind = normalizeLookupText(registration.selection_kind).toLowerCase();
  const targetService = normalizeLookupText(registration.target_service).toLowerCase();
  const productFamily = normalizeLookupText(registration.product_family).toLowerCase();
  const snapshotPrice =
    snapshot.price_ksh === null || snapshot.price_ksh === undefined || snapshot.price_ksh === ''
      ? null
      : Number(snapshot.price_ksh);
  const isDomainOnly =
    selectionKind === 'domain' ||
    targetService === 'domain_registration_only' ||
    targetService === 'domain_registration' ||
    productFamily === 'domain_registration';

  return {
    domainExtension:
      normalizeLookupText(snapshot.domain_extension) ||
      normalizeLookupText(registration.domain_extension),
    package:
      normalizeLookupText(snapshot.package) ||
      normalizeLookupText(registration.package_name),
    period:
      normalizeLookupText(snapshot.period) ||
      formatBillingLabel(registration.billing_cycle, registration.billing_period_months),
    plus:
      normalizeLookupText(snapshot.plus) ||
      (!isDomainOnly ? humanizeLookupLabel(productFamily || targetService) : ''),
    priceKsh: Number.isFinite(snapshotPrice) ? snapshotPrice : registration.quoted_price_ksh,
    registrarName:
      normalizeLookupText(snapshot.registrar_name) ||
      normalizeLookupText(registration.registrar_name),
    type: normalizeLookupText(snapshot.type),
  };
}

function createDomainOfferingDraft(existingOffer = null) {
  return {
    billingPeriodMonths: existingOffer ? String(existingOffer.billing_period_months || 12) : '12',
    domainExtensionId: existingOffer ? existingOffer.domain_extension_id || '' : '',
    isActive: existingOffer ? Boolean(existingOffer.is_active) : true,
    offeringId: existingOffer ? existingOffer.id : '',
    registrationPriceKsh: existingOffer
      ? String(existingOffer.registration_price_ksh ?? '')
      : '',
    renewalPriceKsh: existingOffer
      ? String(existingOffer.renewal_price_ksh ?? existingOffer.registration_price_ksh ?? '')
      : '',
    transferPriceKsh: existingOffer && existingOffer.transfer_price_ksh != null
      ? String(existingOffer.transfer_price_ksh)
      : '',
  };
}

function createServiceOfferingDraft(existingOffer = null) {
  return {
    billingCycle: '',
    billingPeriodMonths: existingOffer ? String(existingOffer.billing_period_months || 1) : '1',
    isActive: existingOffer ? Boolean(existingOffer.is_active) : true,
    offeringId: existingOffer ? existingOffer.id : '',
    planCode: existingOffer ? existingOffer.plan_code || '' : '',
    planName: existingOffer ? existingOffer.plan_name || '' : '',
    priceKsh: existingOffer ? String(existingOffer.price_ksh ?? '') : '',
    serviceProductId: existingOffer ? existingOffer.service_product_id || '' : '',
  };
}

function createServicePackageDraft(existingPackage = null) {
  return {
    detailsJson: existingPackage
      ? JSON.stringify(existingPackage.details_json || {}, null, 2)
      : '{}',
    displayOrder: existingPackage
      ? String(existingPackage.display_order ?? 0)
      : '0',
    featureBulletsText:
      existingPackage && Array.isArray(existingPackage.feature_bullets_json)
        ? existingPackage.feature_bullets_json.join(' | ')
        : '',
    isActive: existingPackage ? Boolean(existingPackage.is_active) : true,
    packageCode: existingPackage ? existingPackage.package_code || '' : '',
    packageId: existingPackage ? existingPackage.id : '',
    packageName: existingPackage ? existingPackage.package_name || '' : '',
    serviceProductId: existingPackage ? existingPackage.service_product_id || '' : '',
    shortDescription: existingPackage
      ? existingPackage.short_description || ''
      : '',
  };
}

function createServicePackagePriceDraft(existingPrice = null) {
  return {
    billingCycle: existingPrice ? existingPrice.billing_cycle || '' : '',
    billingLabel: existingPrice ? existingPrice.billing_label || '' : '',
    billingPeriodMonths: existingPrice
      ? String(existingPrice.billing_period_months || 1)
      : '1',
    currencyCode: existingPrice ? existingPrice.currency_code || 'KES' : 'KES',
    isActive: existingPrice ? Boolean(existingPrice.is_active) : true,
    isDefault: existingPrice ? Boolean(existingPrice.is_default) : false,
    priceId: existingPrice ? existingPrice.id : '',
    priceKsh: existingPrice ? String(existingPrice.price_ksh ?? '') : '',
    setupFeeKsh:
      existingPrice && existingPrice.setup_fee_ksh != null
        ? String(existingPrice.setup_fee_ksh)
        : '0',
  };
}

function formatFeatureHighlights(value) {
  if (!value) {
    return '—';
  }

  if (Array.isArray(value)) {
    const highlights = value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);

    return highlights.length ? highlights.join(' | ') : '—';
  }

  return String(value);
}

function getBooleanFieldLabels(field = {}) {
  return {
    falseLabel: field.falseLabel || 'Inactive',
    trueLabel: field.trueLabel || 'Active',
  };
}

function formatBooleanDraftValue(field, value) {
  const labels = getBooleanFieldLabels(field);
  return value ? labels.trueLabel : labels.falseLabel;
}

function formatPackageDefaultBilling(servicePackage) {
  if (
    !servicePackage ||
    Number(servicePackage.price_count || 0) < 1 ||
    (!servicePackage.default_billing_cycle &&
      !servicePackage.default_billing_period_months)
  ) {
    return 'No pricing';
  }

  return formatBillingLabel(
    servicePackage.default_billing_cycle,
    servicePackage.default_billing_period_months
  );
}

function formatPackageDefaultPrice(servicePackage) {
  if (
    !servicePackage ||
    Number(servicePackage.price_count || 0) < 1 ||
    servicePackage.default_price_ksh === null ||
    servicePackage.default_price_ksh === undefined
  ) {
    return 'No pricing';
  }

  return formatCurrencyKsh(servicePackage.default_price_ksh);
}

function createRegistrarDraft(existingRegistrar = null) {
  return {
    apiEndpoint: existingRegistrar ? existingRegistrar.api_endpoint || '' : '',
    isActive: existingRegistrar ? Boolean(existingRegistrar.is_active) : true,
    name: existingRegistrar ? existingRegistrar.name || '' : '',
    primaryEmail: existingRegistrar ? existingRegistrar.primary_email || '' : '',
    primaryPhone: existingRegistrar ? existingRegistrar.primary_phone || '' : '',
    notificationEmail: existingRegistrar
      ? existingRegistrar.notification_email || ''
      : '',
  };
}

function formatRegistrarDraftValue(field, draft) {
  if (field.type === 'boolean') {
    return formatBooleanDraftValue(field, draft[field.key]);
  }

  const value = draft[field.key];
  return value ? String(value) : 'Required';
}

function getMissingRegistrarDraftFields(draft) {
  return REGISTRAR_FORM_FIELDS.filter((field) => field.type !== 'boolean')
    .filter((field) => !String(draft[field.key] || '').trim())
    .map((field) => field.label);
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

function buildEmailDeliveryNote(emailDelivery, label = 'Credential email') {
  if (!emailDelivery) {
    return null;
  }

  if (emailDelivery.status === 'sent') {
    return `${label} sent to ${emailDelivery.destination}.`;
  }

  if (emailDelivery.status === 'failed') {
    return `${label} failed: ${emailDelivery.reason || 'Unknown error.'}`;
  }

  if (emailDelivery.status === 'skipped') {
    if (emailDelivery.reason === 'missing_primary_email') {
      return `${label} skipped because no registrar primary email is set.`;
    }

    if (emailDelivery.reason === 'email_service_not_configured') {
      return `${label} skipped because the email service is not configured.`;
    }

    return `${label} skipped.`;
  }

  return `${label} status: ${emailDelivery.status}.`;
}

function buildRegistrarDeletionImpactLines(impact) {
  if (!impact || !impact.registrar || !impact.summary) {
    return ['Registrar deletion impact could not be loaded.'];
  }

  const registrar = impact.registrar;
  const summary = impact.summary;

  return [
    `Registrar: ${registrar.name} (${toDisplay(registrar.registrar_code)})`,
    '',
    'This action is permanent and irreversible.',
    'A deletion snapshot will be written to registrar_deletion_audit before the live registrar is removed.',
    '',
    'Live data that will be deleted:',
    `- Registrar profile and access metadata`,
    `- Domain offers: ${toDisplay(summary.domain_offering_count)}`,
    `- Registrar-owned service products: ${toDisplay(summary.service_product_count)}`,
    `- Service offerings: ${toDisplay(summary.service_offering_count)}`,
    `- Service packages: ${toDisplay(summary.service_package_count)}`,
    `- Package prices: ${toDisplay(summary.service_package_price_count)}`,
    `- Bundles: ${toDisplay(summary.bundle_count)}`,
    `- Bundle items: ${toDisplay(summary.bundle_item_count)}`,
    `- API keys: ${toDisplay(summary.api_key_count)}`,
    `- Auth challenges: ${toDisplay(summary.auth_challenge_count)}`,
    `- Portal sessions: ${toDisplay(summary.portal_session_count)}`,
    `- Domain updater audit events: ${toDisplay(summary.audit_event_count)}`,
    `- Enabled product families: ${toDisplay(summary.enabled_family_count)}`,
    '',
    'Historical records that will be preserved but detached from this registrar:',
    `- Registrations: ${toDisplay(summary.linked_registration_count)} linked, ${toDisplay(summary.processed_registration_count)} processed`,
    `- Registrar requests: ${toDisplay(summary.linked_request_count)}`,
  ];
}

function buildRegistrationLookupContent(lookup) {
  const registration = lookup.registration;
  const selectionSummary = buildRegistrationSelectionSummary(registration);
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
    ` First Name: ${toDisplay(registration.first_name)}`,
    ` Last Name: ${toDisplay(registration.last_name)}`,
    ` Phone: ${toDisplay(registration.phone)}`,
    ` Email: ${toDisplay(registration.email)}`,
    ` Company Name: ${toDisplay(registration.company_name)}`,
    ` KRA PIN: ${toDisplay(registration.kra_pin)}`,
    ` Street Address: ${toDisplay(registration.street_address)}`,
    ` City: ${toDisplay(registration.city)}`,
    ` State: ${toDisplay(registration.state)}`,
    ` Post Code: ${toDisplay(registration.postcode)}`,
    ` Country: ${toDisplay(registration.country)}`,
    '',
    ' Order Summary',
    ` Domain: ${registration.domain_name}`,
    ` Domain Extension: ${toDisplay(selectionSummary.domainExtension)}`,
    ...(selectionSummary.plus
      ? [` Plus: ${toDisplay(selectionSummary.plus)}`]
      : []),
    ...(selectionSummary.type
      ? [` Type: ${toDisplay(selectionSummary.type)}`]
      : []),
    ...(selectionSummary.package
      ? [` Package: ${toDisplay(selectionSummary.package)}`]
      : []),
    ` Period: ${toDisplay(selectionSummary.period)}`,
    ` Price: ${formatCurrencyKsh(selectionSummary.priceKsh)}`,
    '',
    ' Registrar',
    ` Chosen Registrar: ${toDisplay(selectionSummary.registrarName)}`,
    ` Registrar Active: ${registration.registrar_is_active == null ? 'Unknown' : formatBoolean(registration.registrar_is_active)}`,
    ` Registrar Notification Email: ${toDisplay(registration.registrar_notification_email)}`,
    ` Registrar API Endpoint: ${toDisplay(registration.registrar_api_endpoint)}`,
    '',
    ' Selection Snapshot',
    `${formatJson(registration.selection_snapshot_json)}`,
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
      visiblePortalKeys: {},
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
    this.interactionLayers = [];
    this.modalActive = false;
    this.nextInteractionLayerId = 0;
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
      if (this.hasActiveInteractionLayer()) {
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

        if (ch === 'k') {
          await this.createPortalKeyForSelectedRegistrar();
          return;
        }

        if (ch === 'o') {
          await this.openDomainOfferManager();
          return;
        }

        if (ch === 'p') {
          await this.openServicePackageManager();
          return;
        }

        if (ch === 't') {
          await this.toggleSelectedRegistrar();
          return;
        }

        if (ch === 'D') {
          await this.deleteSelectedRegistrar();
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

  openInteractionLayer() {
    const layerId = `layer_${++this.nextInteractionLayerId}`;
    this.interactionLayers.push(layerId);
    this.modalActive = true;
    return layerId;
  }

  closeInteractionLayer(layerId) {
    const layerIndex = this.interactionLayers.lastIndexOf(layerId);

    if (layerIndex >= 0) {
      this.interactionLayers.splice(layerIndex, 1);
    }

    this.modalActive = this.interactionLayers.length > 0;
  }

  hasActiveInteractionLayer() {
    return this.interactionLayers.length > 0;
  }

  isTopInteractionLayer(layerId) {
    return this.interactionLayers[this.interactionLayers.length - 1] === layerId;
  }

  bindInteractionKey(widget, keys, layerId, handler) {
    widget.key(keys, (...args) => {
      if (!this.isTopInteractionLayer(layerId)) {
        return;
      }

      return handler(...args);
    });
  }

  openWorkflowProgressModal({ title, summary, steps }) {
    const app = this;
    const layerId = this.openInteractionLayer();
    const stepState = steps.map((label) => ({
      detail: '',
      label,
      status: 'pending',
    }));

    const modal = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '74%',
      height: Math.max(16, stepState.length * 2 + 10),
      border: 'line',
      label: ` ${title} `,
      style: {
        bg: 'black',
        fg: 'white',
        border: {
          fg: 'cyan',
        },
      },
    });

    const summaryBox = blessed.box({
      parent: modal,
      top: 1,
      left: 2,
      right: 2,
      height: 3,
      content: summary,
      style: {
        fg: 'white',
      },
    });

    const stepsBox = blessed.box({
      parent: modal,
      top: 5,
      left: 2,
      right: 2,
      bottom: 2,
      scrollable: true,
      style: {
        fg: 'white',
      },
    });

    const footer = blessed.box({
      parent: modal,
      left: 2,
      right: 2,
      bottom: 0,
      height: 1,
      content: ' Operation in progress. Please wait...',
      style: {
        fg: 'yellow',
      },
    });

    let closable = false;
    let closed = false;

    const renderSteps = () => {
      const lines = [];

      stepState.forEach((step) => {
        const statusToken =
          step.status === 'success'
            ? '[OK]'
            : step.status === 'warning'
            ? '[!]'
            : step.status === 'error'
            ? '[X]'
            : step.status === 'running'
            ? '[~]'
            : '[ ]';

        lines.push(`${statusToken} ${step.label}`);

        if (step.detail) {
          lines.push(`    ${step.detail}`);
        }

        lines.push('');
      });

      stepsBox.setContent(lines.join('\n').trimEnd());
      this.screen.render();
    };

    const close = () => {
      if (closed || !closable || !this.isTopInteractionLayer(layerId)) {
        return;
      }

      closed = true;
      modal.detach();
      this.screen.restoreFocus();
      this.closeInteractionLayer(layerId);
      this.screen.render();
    };

    this.bindInteractionKey(modal, ['enter', 'escape', 'x'], layerId, () => close());

    this.screen.saveFocus();
    modal.focus();
    renderSteps();
    this.screen.render();

    const updateStep = (index, status, detail) => {
      if (!stepState[index]) {
        return;
      }

      stepState[index].status = status;
      stepState[index].detail = detail || '';
      renderSteps();
    };

    return {
      close,
      completeStep(index, detail) {
        updateStep(index, 'success', detail);
      },
      failStep(index, detail) {
        updateStep(index, 'error', detail);
      },
      setClosable(message = ' Press Enter, Escape, or x to close.') {
        closable = true;
        footer.setContent(message);
        footer.style.fg = 'green';
        app.screen.render();
      },
      setSummary(message) {
        summaryBox.setContent(message);
        app.screen.render();
      },
      startStep(index, detail) {
        updateStep(index, 'running', detail);
      },
      warnStep(index, detail) {
        updateStep(index, 'warning', detail);
      },
    };
  }

  rememberVisiblePortalKey(keyResult) {
    if (!keyResult || !keyResult.registrar || !keyResult.registrar.id || !keyResult.apiKey) {
      return;
    }

    this.state.visiblePortalKeys[keyResult.registrar.id] = {
      apiKey: keyResult.apiKey,
      createdAt: keyResult.createdAt || null,
      expiresAt: keyResult.expiresAt || null,
      keyPrefix: keyResult.keyPrefix || null,
    };
  }

  getVisiblePortalKey(registrarId) {
    if (!registrarId) {
      return null;
    }

    return this.state.visiblePortalKeys[registrarId] || null;
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
      registrars: `${common} | a add | e edit | k new API key | o domain offers | p packages | t toggle active | D delete`,
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
            `${truncate(`${registrar.registrar_code} ${registrar.name}`, 30)}  requests:${registrar.total_requests}  processed:${registrar.processed_requests}\nemail:${toDisplay(registrar.primary_email || registrar.notification_email)}`
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
      content: `${pad('Code', 8)} ${pad('Name', 16)} ${pad('Status', 10)} ${pad('Email', 20)} ${pad('Phone', 14)} ${pad('Req', 6)}`,
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
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
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
              `${pad(registrar.registrar_code || '—', 8)} ${pad(registrar.name, 16)} ${pad(registrar.is_active ? 'ACTIVE' : 'INACTIVE', 10)} ${pad(registrar.primary_email || registrar.notification_email || '—', 20)} ${pad(registrar.primary_phone || '—', 14)} ${pad(registrar.total_requests, 6)}`
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
      const visiblePortalKey = this.getVisiblePortalKey(registrar.id);

      detailsPanel.setContent(
        [
          '',
          ` Code: ${toDisplay(registrar.registrar_code)}`,
          ` Name: ${registrar.name}`,
          ` Active: ${formatBoolean(registrar.is_active)}`,
          ` Primary Email: ${toDisplay(registrar.primary_email)}`,
          ` Primary Phone: ${toDisplay(registrar.primary_phone)}`,
          ` Notification Email: ${toDisplay(registrar.notification_email)}`,
          ` API Endpoint: ${toDisplay(registrar.api_endpoint)}`,
          ` API Keys: ${toDisplay(registrar.active_api_key_count)}/${toDisplay(registrar.api_key_count)} active`,
          ` Latest Key Prefix: ${toDisplay(registrar.latest_api_key_prefix)}`,
          ` Latest Key Status: ${toDisplay(registrar.latest_api_key_status)}`,
          ` Latest Key Expires: ${formatDateTime(registrar.latest_api_key_expires_at)}`,
          ` Latest Key Created: ${formatDateTime(registrar.latest_api_key_created_at)}`,
          ` Latest Key Last Used: ${formatDateTime(registrar.latest_api_key_last_used_at)}`,
          ` API Key Secret: ${toDisplay(
            visiblePortalKey ? visiblePortalKey.apiKey : null
          )}`,
          ` Key Storage: ${registrar.latest_api_key_prefix ? 'Stored hashed for verification.' : 'No key issued yet.'}`,
          ` Key Secret Scope: ${
            visiblePortalKey
              ? 'Visible in this admin session after API key generation.'
              : 'Raw secret is not recoverable after generation.'
          }`,
          ` Total Requests: ${registrar.total_requests}`,
          ` Processed Requests: ${registrar.processed_requests}`,
          ` Domain Offers: ${registrar.domain_extension_count}`,
          ` Service Offerings: ${toDisplay(registrar.service_offering_count)}`,
          ` Service Packages: ${toDisplay(registrar.service_package_count)}`,
          ` Package Prices: ${toDisplay(registrar.service_package_price_count)}`,
          ` Bundles: ${registrar.bundle_count}`,
          ` Created At: ${formatDateTime(registrar.created_at)}`,
          ` Updated At: ${formatDateTime(registrar.updated_at)}`,
          '',
          ' Actions:',
          '  a  Add registrar',
          '  e  Open registrar editor',
          '  k  Generate a new registrar API key',
          '  o  Manage domain offers and pricing',
          '  p  Manage packages and pricing',
          '  t  Toggle active / inactive',
          '  D  Delete and unboard registrar',
        ].join('\n')
      );
    };

    list.on('select item', (_, index) => {
      this.selectedIndices.registrars = index;
      renderDetails(index);
      this.screen.render();
    });

    list.key(['a'], async () => {
      await this.openRegistrarForm();
    });
    list.key(['e'], async () => {
      await this.editSelectedRegistrar();
    });
    list.key(['k'], async () => {
      await this.createPortalKeyForSelectedRegistrar();
    });
    list.key(['o'], async () => {
      await this.openDomainOfferManager();
    });
    list.key(['p'], async () => {
      await this.openServicePackageManager();
    });
    list.key(['t'], async () => {
      await this.toggleSelectedRegistrar();
    });
    list.key(['D'], async () => {
      await this.deleteSelectedRegistrar();
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
          ` First Name: ${toDisplay(failedPush.first_name)}`,
          ` Last Name: ${toDisplay(failedPush.last_name)}`,
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
    const layerId = this.openInteractionLayer();

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
      this.closeInteractionLayer(layerId);
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
      const layerId = this.openInteractionLayer();
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
        this.closeInteractionLayer(layerId);
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
      const layerId = this.openInteractionLayer();
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
        this.closeInteractionLayer(layerId);
        this.screen.render();
        resolve();
      };

      this.bindInteractionKey(modal, ['escape', 'x'], layerId, () => close());
      this.bindInteractionKey(details, ['escape', 'x'], layerId, () => close());

      this.screen.saveFocus();
      details.focus();
      details.setScroll(0);
      this.screen.render();
    });
  }

  async openDangerPhrasePrompt({ title, lines, phrase }) {
    const contentLines = Array.isArray(lines) ? lines : [String(lines || '')];

    return new Promise((resolve) => {
      const layerId = this.openInteractionLayer();
      const modal = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '86%',
        height: '80%',
        border: 'line',
        label: ` ${title} `,
        style: {
          bg: 'black',
          fg: 'white',
          border: {
            fg: 'red',
          },
        },
      });

      const details = blessed.box({
        parent: modal,
        top: 1,
        left: 2,
        right: 2,
        height: '68%',
        scrollable: true,
        alwaysScroll: true,
        keys: true,
        mouse: true,
        vi: true,
        scrollbar: {
          ch: ' ',
          style: {
            bg: 'red',
          },
        },
        content: contentLines.join('\n'),
        style: {
          fg: 'white',
        },
      });

      blessed.box({
        parent: modal,
        top: '71%',
        left: 2,
        right: 2,
        height: 2,
        content: `Type ${phrase} to continue. Press Esc to cancel.`,
        style: {
          fg: 'yellow',
        },
      });

      const input = blessed.textbox({
        parent: modal,
        top: '77%',
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
            fg: 'red',
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
        content: ' Type the phrase in the white box. Press Enter to confirm or Esc to cancel.',
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
        this.closeInteractionLayer(layerId);
        this.screen.render();

        if (error || result === null) {
          resolve(null);
          return;
        }

        resolve(String(result || '').trim());
      });
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
    const isMultiline = field.multiline === true;

    return new Promise((resolve) => {
      const layerId = this.openInteractionLayer();
      const modal = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: isMultiline ? '82%' : '76%',
        height: isMultiline ? '78%' : 13,
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
        height: isMultiline ? 4 : 3,
        tags: true,
        content: `{bold}${field.label}{/bold}\n${field.description}`,
        style: {
          fg: 'white',
        },
      });

      const currentValueBox = isMultiline
        ? null
        : blessed.box({
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

      const input = (isMultiline ? blessed.textarea : blessed.textbox)({
        parent: modal,
        top: isMultiline ? 6 : 7,
        left: 2,
        right: 2,
        bottom: isMultiline ? 2 : undefined,
        height: isMultiline ? undefined : 3,
        inputOnFocus: false,
        keys: true,
        mouse: true,
        scrollable: isMultiline,
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
        content: isMultiline
          ? ' Type in the white box. Press Ctrl+S to save this field or Esc to cancel. Enter adds a new line.'
          : ' Type in the white box. Press Enter to save this field or Esc to cancel.',
        style: {
          fg: 'green',
        },
      });

      this.screen.saveFocus();
      input.focus();
      input.setValue(editorValue);
      this.screen.render();

      if (isMultiline) {
        this.bindInteractionKey(input, ['C-s'], layerId, () => {
          if (typeof input._done === 'function') {
            input._done(null, input.getValue());
          }
        });
      }

      input.readInput((error, result) => {
        if (currentValueBox) {
          currentValueBox.detach();
        }
        modal.detach();
        this.screen.restoreFocus();
        this.closeInteractionLayer(layerId);
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
      const layerId = this.openInteractionLayer();
      const labels = getBooleanFieldLabels(field);
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
        { label: labels.trueLabel, value: true },
        { label: labels.falseLabel, value: false },
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
        this.closeInteractionLayer(layerId);
        this.screen.render();
        resolve(value);
      };

      this.bindInteractionKey(modal, ['escape', 'x'], layerId, () => done(null));
      this.bindInteractionKey(list, ['escape', 'x'], layerId, () => done(null));
      this.bindInteractionKey(list, ['enter'], layerId, () => {
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

  getDraftFieldDisplayValue(field, draft) {
    if (field.type === 'boolean') {
      return formatBooleanDraftValue(field, draft[field.key]);
    }

    if (field.type === 'choice') {
      const option = (field.options || []).find(
        (item) => String(item.value) === String(draft[field.key] || '')
      );
      return option ? option.label : 'Not set';
    }

    const value = draft[field.key];
    return value === null || value === undefined || value === ''
      ? 'Not set'
      : String(value).replace(/\s+/g, ' ').trim();
  }

  async openChoiceFieldEditor(field, currentValue) {
    const options = field.options || [];

    if (!options.length) {
      this.setStatus(`No choices are available for ${field.label} right now.`, 'warning');
      return null;
    }

    return new Promise((resolve) => {
      const layerId = this.openInteractionLayer();
      const modal = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '68%',
        height: '70%',
        border: 'line',
        label: ` Choose ${field.label} `,
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
        tags: true,
        content: `{bold}${field.label}{/bold}\n${field.description}`,
        style: {
          fg: 'white',
        },
      });

      const list = blessed.list({
        parent: modal,
        top: 5,
        left: 1,
        width: '46%',
        bottom: 2,
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
        items: options.map((option) => option.label),
      });

      const details = blessed.box({
        parent: modal,
        top: 5,
        left: '46%',
        right: 1,
        bottom: 2,
        border: 'line',
        label: ' Choice Details ',
        scrollable: true,
        style: {
          border: {
            fg: 'yellow',
          },
        },
      });

      blessed.box({
        parent: modal,
        bottom: 0,
        left: 2,
        right: 2,
        height: 1,
        content: ' Up/Down move | Enter select | Esc cancel ',
        style: {
          fg: 'green',
        },
      });

      const renderDetails = (selectedIndex) => {
        const option = options[selectedIndex] || options[0];

        details.setContent(
          [
            '',
            ` Label: ${option.label}`,
            ` Value: ${toDisplay(option.value)}`,
            '',
            ` Description: ${toDisplay(option.description)}`,
          ].join('\n')
        );
      };

      const done = (value) => {
        modal.detach();
        this.screen.restoreFocus();
        this.closeInteractionLayer(layerId);
        this.screen.render();
        resolve(value);
      };

      this.bindInteractionKey(modal, ['escape', 'x'], layerId, () => done(null));
      this.bindInteractionKey(list, ['escape', 'x'], layerId, () => done(null));
      this.bindInteractionKey(list, ['enter'], layerId, () => {
        const option = options[list.selected] || options[0];
        done(option.value);
      });

      list.on('select item', (_, index) => {
        renderDetails(index);
        this.screen.render();
      });

      const selectedIndex = Math.max(
        0,
        options.findIndex((option) => String(option.value) === String(currentValue || ''))
      );

      this.screen.saveFocus();
      renderDetails(selectedIndex);
      list.focus();
      list.select(selectedIndex);
      this.screen.render();
    });
  }

  async openStructuredDraftEditor({
    title,
    fields,
    draft,
    buildPreviewLines,
  }) {
    return new Promise((resolve) => {
      const layerId = this.openInteractionLayer();
      const modal = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '88%',
        height: '82%',
        border: 'line',
        label: title,
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
        content: ' Enter edit selected field | s save draft | x close | Esc cancel | Up/Down move between fields ',
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
        this.closeInteractionLayer(layerId);
        this.screen.render();
        resolve(value);
      };

      const renderFieldList = () => {
        fieldList.setItems(
          fields.map((field) =>
            `${pad(field.label, 22)} ${truncate(this.getDraftFieldDisplayValue(field, draft), 26)}`
          )
        );
      };

      const renderFieldDetails = (selectedIndex) => {
        const field = fields[selectedIndex] || fields[0];
        const previewLines = buildPreviewLines(draft);

        detailsPanel.setContent(
          [
            '',
            ` Field: ${field.label}`,
            '',
            ` Current Value: ${this.getDraftFieldDisplayValue(field, draft)}`,
            '',
            ` Description: ${field.description}`,
            '',
            ' Editing Flow:',
            '  1. Move to the field you want.',
            '  2. Press Enter to edit only that field.',
            '  3. Press s when the full draft looks right.',
            '',
            ' Draft Preview:',
            ...previewLines.map((line) => `  ${line}`),
          ].join('\n')
        );
      };

      const editSelectedField = async () => {
        const selectedIndex = fieldList.selected || 0;
        const field = fields[selectedIndex];

        if (!field) {
          return;
        }

        if (field.type === 'boolean') {
          const nextValue = await this.openBooleanFieldEditor(field, draft[field.key]);

          if (nextValue !== null) {
            draft[field.key] = nextValue;
          }
        } else if (field.type === 'choice') {
          const nextValue = await this.openChoiceFieldEditor(field, draft[field.key]);

          if (nextValue !== null) {
            draft[field.key] = nextValue;
          }
        } else {
          const nextValue = await this.openTextFieldEditor(field, draft[field.key]);

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

      this.bindInteractionKey(modal, ['escape', 'x'], layerId, () => cleanup(null));
      this.bindInteractionKey(modal, ['s'], layerId, () => cleanup({ ...draft }));
      this.bindInteractionKey(fieldList, ['escape', 'x'], layerId, () => cleanup(null));
      this.bindInteractionKey(fieldList, ['s'], layerId, () => cleanup({ ...draft }));
      this.bindInteractionKey(fieldList, ['enter'], layerId, async () => {
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
  }

  async openRegistrarForm(existingRegistrar = null) {
    this.modalActive = true;

    try {
      const draft = createRegistrarDraft(existingRegistrar);
      const formTitle = existingRegistrar
        ? ` Edit Registrar: ${existingRegistrar.name} `
        : ' Add Registrar ';

      const result = await new Promise((resolve) => {
        const layerId = this.openInteractionLayer();
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
          this.closeInteractionLayer(layerId);
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
              '  3. Complete every registrar profile field before saving.',
              '  4. Press s when the full registrar draft looks right.',
              '',
              ' Draft Preview:',
              `  Name: ${draft.name || 'Required'}`,
              `  Primary Email: ${draft.primaryEmail || 'Required'}`,
              `  Primary Phone: ${draft.primaryPhone || 'Required'}`,
              `  API Endpoint: ${draft.apiEndpoint || 'Required'}`,
              `  Notification Email: ${draft.notificationEmail || 'Required'}`,
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

        this.bindInteractionKey(modal, ['escape', 'x'], layerId, () => cleanup(null));
        this.bindInteractionKey(modal, ['s'], layerId, () => cleanup({ ...draft }));
        this.bindInteractionKey(fieldList, ['escape', 'x'], layerId, () => cleanup(null));
        this.bindInteractionKey(fieldList, ['s'], layerId, () => cleanup({ ...draft }));
        this.bindInteractionKey(fieldList, ['enter'], layerId, async () => {
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
        primaryEmail: result.primaryEmail,
        primaryPhone: result.primaryPhone,
        notificationEmail: result.notificationEmail,
      };
      const missingRegistrarFields = getMissingRegistrarDraftFields(payload);

      if (missingRegistrarFields.length) {
        this.setStatus(
          `Complete all registrar profile fields before saving. Missing: ${missingRegistrarFields.join(', ')}.`,
          'warning'
        );
        return;
      }

      let creationResult = null;

      if (existingRegistrar) {
        await this.withLoading('Updating registrar...', async () => {
          await adminService.updateRegistrar(existingRegistrar.id, payload);
          this.state.view = 'registrars';
          this.updateChrome();
          this.state.registrars = await adminService.listRegistrars();
          this.renderView();
          this.setStatus(`Registrar "${payload.name}" updated successfully.`, 'success');
        });
      } else {
        const progress = this.openWorkflowProgressModal({
          title: 'Registrar Onboarding',
          summary: `Onboarding ${payload.name}. The admin interface will create the registrar workspace, send the onboarding email, and refresh the management view.`,
          steps: [
            'Onboard registrar workspace',
            'Send onboarding email',
            'Refresh registrar management view',
          ],
        });

        let activeStepIndex = 0;

        try {
          progress.startStep(0, `Creating registrar ${payload.name} and issuing the first API key...`);

          const created = await adminService.createRegistrar(payload, {
            sendCredentialEmail: false,
          });

          creationResult = created && created.onboarding ? created : null;

          if (!creationResult || !creationResult.onboarding || !creationResult.onboarding.apiKey) {
            throw new Error('Registrar onboarding completed without returning the new API key.');
          }

          progress.completeStep(
            0,
            `Registrar ${payload.name} is ready with API key prefix ${toDisplay(creationResult.onboarding.keyPrefix)}.`
          );

          activeStepIndex = 1;
          progress.startStep(
            1,
            `Sending the onboarding email to ${payload.primaryEmail}...`
          );

          const emailDelivery = await adminService.sendRegistrarPortalCredentialEmail(
            creationResult.registrar.id,
            creationResult.onboarding.apiKey,
            { emailType: 'onboarding' }
          );
          const onboardingEmailNote =
            buildEmailDeliveryNote(emailDelivery, 'Onboarding email') ||
            'Onboarding email delivery completed.';

          creationResult.onboarding = {
            ...creationResult.onboarding,
            emailDelivery,
            note: onboardingEmailNote,
          };

          if (emailDelivery && emailDelivery.status === 'sent') {
            progress.completeStep(1, onboardingEmailNote);
          } else {
            progress.warnStep(1, onboardingEmailNote);
          }

          activeStepIndex = 2;
          progress.startStep(2, 'Refreshing registrar summaries and reopening the registrars view...');
          this.state.view = 'registrars';
          this.updateChrome();
          this.state.registrars = await adminService.listRegistrars();
          this.renderView();
          progress.completeStep(
            2,
            `Registrar ${payload.name} now appears in the registrar management interface.`
          );
          progress.setSummary(`Registrar ${payload.name} was onboarded successfully.`);
          progress.setClosable();
          progress.close();

          const statusNote = buildEmailDeliveryNote(
            creationResult.onboarding.emailDelivery,
            'Onboarding email'
          );
          const statusTone =
            creationResult.onboarding.emailDelivery &&
            creationResult.onboarding.emailDelivery.status === 'sent'
              ? 'success'
              : 'warning';

          this.setStatus(
            `Registrar "${payload.name}" created successfully.${statusNote ? ` ${statusNote}` : ''}`,
            statusTone
          );
        } catch (error) {
          progress.failStep(activeStepIndex, error.message);
          progress.setSummary(`Registrar onboarding stopped: ${error.message}`);
          progress.setClosable();
          progress.close();
          throw error;
        }
      }

      if (creationResult && creationResult.onboarding && creationResult.onboarding.apiKey) {
        this.rememberVisiblePortalKey(creationResult.onboarding);
        this.renderView();
        this.screen.render();
        await this.showPortalKeyModal(creationResult.onboarding);
      }
    } catch (error) {
      this.setStatus(error.message, 'error');
    } finally {
      this.modalActive = false;
      this.screen.render();
    }
  }

  async refreshRegistrarsState() {
    this.state.registrars = await adminService.listRegistrars();
    this.renderView();
    this.screen.render();
  }

  async openDomainOfferingForm(registrar, domainExtensions, existingOffer = null) {
    const draft = createDomainOfferingDraft(existingOffer);
    const fields = [
      {
        description: 'Choose the domain extension this registrar offers.',
        key: 'domainExtensionId',
        label: 'Domain Extension',
        options: domainExtensions.map((extension) => ({
          description: `${extension.label} ${extension.extension} | ${extension.category_key}`,
          label: `${extension.label} ${extension.extension}`,
          value: extension.id,
        })),
        type: 'choice',
      },
      {
        description: 'How many months this price covers. Use 12 for yearly or 1 for monthly.',
        key: 'billingPeriodMonths',
        label: 'Billing Months',
        type: 'text',
      },
      {
        description: 'KSh price for a brand new registration.',
        key: 'registrationPriceKsh',
        label: 'Registration Price',
        type: 'text',
      },
      {
        description: 'KSh price for renewal. Leave aligned with registration if they match.',
        key: 'renewalPriceKsh',
        label: 'Renewal Price',
        type: 'text',
      },
      {
        description: 'Optional KSh transfer-in price. Leave blank if not used yet.',
        key: 'transferPriceKsh',
        label: 'Transfer Price',
        type: 'text',
      },
      {
        description: 'Controls whether this offering is shown as active in operations.',
        key: 'isActive',
        label: 'Active Status',
        type: 'boolean',
      },
    ];

    return this.openStructuredDraftEditor({
      title: existingOffer
        ? ` Edit Domain Offer: ${registrar.name} `
        : ` Add Domain Offer: ${registrar.name} `,
      fields,
      draft,
      buildPreviewLines: (currentDraft) => {
        const selectedExtension = domainExtensions.find(
          (extension) => extension.id === currentDraft.domainExtensionId
        );

        return [
          `Registrar: ${registrar.name}`,
          `Extension: ${selectedExtension ? `${selectedExtension.label} ${selectedExtension.extension}` : 'Not set'}`,
          `Billing: ${formatBillingLabel(null, currentDraft.billingPeriodMonths)}`,
          `Registration: ${formatCurrencyKsh(currentDraft.registrationPriceKsh)}`,
          `Renewal: ${formatCurrencyKsh(currentDraft.renewalPriceKsh)}`,
          `Transfer: ${formatCurrencyKsh(currentDraft.transferPriceKsh)}`,
          `Active: ${currentDraft.isActive ? 'Active' : 'Inactive'}`,
        ];
      },
    });
  }

  async openServicePackageForm(registrar, serviceProducts, existingPackage = null) {
    const draft = createServicePackageDraft(existingPackage);
    const fields = [
      {
        description: 'Choose the primary service this package belongs to.',
        key: 'serviceProductId',
        label: 'Service',
        options: serviceProducts.map((service) => ({
          description: `${service.name} | ${service.service_category}`,
          label: `${service.name} (${service.service_category})`,
          value: service.id,
        })),
        type: 'choice',
      },
      {
        description: 'Customer-facing package name, for example Starter, Bronze, Business, or Premium.',
        key: 'packageName',
        label: 'Package Name',
        type: 'text',
      },
      {
        description: 'Optional package code. Leave blank to auto-generate from the service and package name.',
        key: 'packageCode',
        label: 'Package Code',
        type: 'text',
      },
      {
        description: 'Short summary shown to help users understand this package quickly.',
        key: 'shortDescription',
        label: 'Short Description',
        type: 'text',
      },
      {
        description: 'Flexible JSON object for package details, for example {"storage":"20 GB","emails":"10"}. You can paste pretty JSON here.',
        key: 'detailsJson',
        label: 'Details JSON',
        multiline: true,
        type: 'text',
      },
      {
        description: 'Feature highlights shown to users. Separate each highlight with "|" characters or put one highlight per line.',
        key: 'featureBulletsText',
        label: 'Feature Highlights',
        multiline: true,
        type: 'text',
      },
      {
        description: 'Display order in package lists. Lower numbers appear first.',
        key: 'displayOrder',
        label: 'Display Order',
        type: 'text',
      },
      {
        description: 'Controls whether this package is active in operations.',
        key: 'isActive',
        label: 'Active Status',
        type: 'boolean',
      },
    ];

    return this.openStructuredDraftEditor({
      title: existingPackage
        ? ` Edit Package: ${registrar.name} `
        : ` Add Package: ${registrar.name} `,
      fields,
      draft,
      buildPreviewLines: (currentDraft) => {
        const selectedService = serviceProducts.find(
          (service) => service.id === currentDraft.serviceProductId
        );
        const generatedPackageCode = selectedService && currentDraft.packageName
          ? `${selectedService.service_code}_${currentDraft.packageName}`
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '_')
              .replace(/^_+|_+$/g, '')
          : 'Auto-generated on save';

        return [
          `Registrar: ${registrar.name}`,
          `Service: ${selectedService ? selectedService.name : 'Not set'}`,
          `Package Name: ${currentDraft.packageName || 'Not set'}`,
          `Package Code: ${currentDraft.packageCode || generatedPackageCode}`,
          `Short Description: ${currentDraft.shortDescription || 'Not set'}`,
          `Feature Highlights: ${currentDraft.featureBulletsText ? currentDraft.featureBulletsText.replace(/\r?\n/g, ' | ') : 'Not set'}`,
          `Display Order: ${currentDraft.displayOrder || '0'}`,
          `Active: ${currentDraft.isActive ? 'Active' : 'Inactive'}`,
        ];
      },
    });
  }

  async openServicePackagePriceForm(registrar, servicePackage, existingPrice = null) {
    const draft = createServicePackagePriceDraft(existingPrice);
    const billingCycleOptions = [
      {
        description: 'Used for monthly recurring prices and 1-month billing periods.',
        label: 'Monthly',
        value: 'monthly',
      },
      {
        description: 'Used for yearly recurring prices and 12-month billing periods.',
        label: 'Yearly',
        value: 'yearly',
      },
      {
        description: 'Used for other billing periods such as quarterly or custom terms.',
        label: 'Custom',
        value: 'custom',
      },
    ];

    const fields = [
      {
        description: 'Billing cycle for this package. Each package keeps a single pricing setup.',
        key: 'billingCycle',
        label: 'Billing Cycle',
        options: billingCycleOptions,
        type: 'choice',
      },
      {
        description: 'How many months this package price covers. Use 1 for monthly or 12 for yearly.',
        key: 'billingPeriodMonths',
        label: 'Billing Months',
        type: 'text',
      },
      {
        description: 'Optional customer-facing billing label. Leave blank to auto-label from the billing months.',
        key: 'billingLabel',
        label: 'Billing Label',
        type: 'text',
      },
      {
        description: 'KSh price for this package.',
        key: 'priceKsh',
        label: 'Package Price',
        type: 'text',
      },
      {
        description: 'Optional setup fee charged for this package.',
        key: 'setupFeeKsh',
        label: 'Setup Fee',
        type: 'text',
      },
      {
        description: 'Three-letter currency code such as KES.',
        key: 'currencyCode',
        label: 'Currency Code',
        type: 'text',
      },
      {
        description: 'Controls whether this package pricing is active in operations.',
        key: 'isActive',
        label: 'Active Status',
        type: 'boolean',
      },
    ];

    return this.openStructuredDraftEditor({
      title: existingPrice
        ? ` Edit Package Pricing: ${servicePackage.package_name} `
        : ` Set Package Pricing: ${servicePackage.package_name} `,
      fields,
      draft,
      buildPreviewLines: (currentDraft) => [
        `Registrar: ${registrar.name}`,
        `Package: ${servicePackage.package_name || 'Not set'}`,
        `Billing: ${currentDraft.billingLabel || formatBillingLabel(currentDraft.billingCycle, currentDraft.billingPeriodMonths)}`,
        `Cycle: ${currentDraft.billingCycle || 'Not set'}`,
        `Price: ${formatCurrencyKsh(currentDraft.priceKsh)}`,
        `Setup Fee: ${formatCurrencyKsh(currentDraft.setupFeeKsh)}`,
        `Currency: ${currentDraft.currencyCode || 'KES'}`,
        `Active: ${currentDraft.isActive ? 'Active' : 'Inactive'}`,
      ],
    });
  }

  async openDomainOfferManager() {
    const registrar = this.getSelectedRegistrar();

    if (!registrar) {
      this.setStatus('Select a registrar first.', 'warning');
      return;
    }

    this.modalActive = true;

    try {
      const loadedData = await this.withLoading(
        `Loading domain offers for ${registrar.name}...`,
        async () =>
          Promise.all([
            adminService.listDomainExtensions(),
            adminService.listRegistrarDomainOfferings(registrar.id),
          ])
      );

      if (!loadedData) {
        return;
      }

      let [domainExtensions, offerings] = loadedData;
      let changed = false;

      const managerResult = await new Promise((resolve) => {
        const layerId = this.openInteractionLayer();
        const modal = blessed.box({
          parent: this.screen,
          top: 'center',
          left: 'center',
          width: '92%',
          height: '86%',
          border: 'line',
          label: ` Domain Offers: ${registrar.name} `,
          style: {
            bg: 'black',
            fg: 'white',
            border: {
              fg: 'cyan',
            },
          },
        });

        const listPanel = blessed.box({
          parent: modal,
          top: 0,
          left: 0,
          width: '64%',
          bottom: 3,
          border: 'line',
          label: ' Offers ',
          style: {
            border: {
              fg: 'green',
            },
          },
        });

        const detailsPanel = blessed.box({
          parent: modal,
          top: 0,
          left: '64%',
          width: '36%',
          bottom: 3,
          border: 'line',
          label: ' Offer Details ',
          alwaysScroll: true,
          keys: true,
          mouse: true,
          scrollable: true,
          vi: true,
          style: {
            border: {
              fg: 'yellow',
            },
          },
        });

        blessed.box({
          parent: modal,
          top: 0,
          left: 1,
          right: 1,
          height: 1,
          content: `${pad('Extension', 16)} ${pad('Billing', 10)} ${pad('Register', 14)} ${pad('Renew', 14)} ${pad('Status', 10)}`,
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
          alwaysScroll: true,
          keys: true,
          vi: true,
          mouse: true,
          scrollable: true,
          scrollbar: {
            ch: ' ',
            style: {
              bg: 'green',
            },
          },
          style: {
            selected: {
              bg: 'green',
              fg: 'black',
              bold: true,
            },
          },
          items: [],
        });

        const getSelectedOffer = () => {
          if (!offerings.length) {
            return null;
          }

          return offerings[Math.max(0, Math.min(list.selected || 0, offerings.length - 1))];
        };

        const renderList = () => {
          list.setItems(
            offerings.length
              ? offerings.map(
                  (offer) =>
                    `${pad(offer.extension || '—', 16)} ${pad(formatBillingLabel(null, offer.billing_period_months), 10)} ${pad(formatCurrencyKsh(offer.registration_price_ksh), 14)} ${pad(formatCurrencyKsh(offer.renewal_price_ksh), 14)} ${pad(offer.is_active ? 'ACTIVE' : 'INACTIVE', 10)}`
                )
              : ['No domain offers yet. Press "a" to add one.']
          );
        };

        const renderDetails = (selectedIndex) => {
          if (!offerings.length) {
            detailsPanel.setContent(
              [
                '',
                ` Registrar: ${registrar.name}`,
                '',
                ' No domain offers have been added yet.',
                '',
                ' Actions:',
                '  a  Add a domain offer',
                '  r  Refresh list',
                '  x  Close manager',
              ].join('\n')
            );
            return;
          }

          const offer = offerings[selectedIndex];

          detailsPanel.setContent(
            [
              '',
              ` Extension: ${offer.extension_label} (${offer.extension})`,
              ` Billing: ${formatBillingLabel(null, offer.billing_period_months)}`,
              ` Registration Price: ${formatCurrencyKsh(offer.registration_price_ksh)}`,
              ` Renewal Price: ${formatCurrencyKsh(offer.renewal_price_ksh)}`,
              ` Transfer Price: ${formatCurrencyKsh(offer.transfer_price_ksh)}`,
              ` Active: ${formatBoolean(offer.is_active)}`,
              ` Updated At: ${formatDateTime(offer.updated_at)}`,
              '',
              ' Actions:',
              '  a  Add another domain offer',
              '  e  Edit selected domain offer',
              '  t  Toggle active / inactive',
              '  r  Refresh list',
              '  x  Close manager',
            ].join('\n')
          );
        };

        const close = () => {
          modal.detach();
          this.screen.restoreFocus();
          this.closeInteractionLayer(layerId);
          this.screen.render();
          resolve({ changed });
        };

        const refreshOfferings = async () => {
          const refreshed = await this.withLoading(
            `Refreshing domain offers for ${registrar.name}...`,
            async () => adminService.listRegistrarDomainOfferings(registrar.id)
          );

          if (!refreshed) {
            return;
          }

          offerings = refreshed;
          renderList();
          const selectedIndex = this.getClampedSelectedIndex('registrars', offerings.length);
          if (offerings.length) {
            list.select(Math.min(list.selected || 0, offerings.length - 1));
            renderDetails(Math.min(list.selected || 0, offerings.length - 1));
          } else {
            renderDetails(0);
          }
          this.screen.render();
        };

        const editOffer = async (existingOffer = null) => {
          const draft = await this.openDomainOfferingForm(
            registrar,
            domainExtensions,
            existingOffer
          );

          if (!draft) {
            this.setStatus('Domain offer edit cancelled.', 'warning');
            return;
          }

          const savedOffers = await this.withLoading(
            existingOffer ? 'Updating domain offer...' : 'Creating domain offer...',
            async () => adminService.saveRegistrarDomainOffering(registrar.id, draft)
          );

          if (!savedOffers) {
            return;
          }

          offerings = savedOffers;
          changed = true;
          renderList();
          if (offerings.length) {
            const nextIndex = existingOffer
              ? Math.max(
                  0,
                  offerings.findIndex((offer) => offer.id === existingOffer.id)
                )
              : offerings.length - 1;
            list.select(nextIndex >= 0 ? nextIndex : 0);
            renderDetails(list.selected || 0);
          } else {
            renderDetails(0);
          }
          this.setStatus(`Saved domain offer for ${registrar.name}.`, 'success');
          this.screen.render();
        };

        const toggleOffer = async () => {
          const selectedOffer = getSelectedOffer();

          if (!selectedOffer) {
            this.setStatus('Select a domain offer first.', 'warning');
            return;
          }

          const confirmed = await this.askConfirmation(
            `Toggle ${selectedOffer.extension} ${formatBillingLabel(null, selectedOffer.billing_period_months)} to ${selectedOffer.is_active ? 'inactive' : 'active'}?`
          );

          if (!confirmed) {
            this.setStatus('Domain offer toggle cancelled.', 'warning');
            return;
          }

          const savedOffers = await this.withLoading(
            'Updating domain offer status...',
            async () =>
              adminService.toggleRegistrarDomainOfferingActive(
                registrar.id,
                selectedOffer.id
              )
          );

          if (!savedOffers) {
            return;
          }

          offerings = savedOffers;
          changed = true;
          renderList();
          if (offerings.length) {
            list.select(Math.max(0, Math.min(list.selected || 0, offerings.length - 1)));
            renderDetails(list.selected || 0);
          } else {
            renderDetails(0);
          }
          this.setStatus(`Updated domain offer status for ${registrar.name}.`, 'success');
          this.screen.render();
        };

        this.bindInteractionKey(modal, ['escape', 'x'], layerId, () => close());
        this.bindInteractionKey(detailsPanel, ['escape', 'x'], layerId, () => close());
        this.bindInteractionKey(list, ['escape', 'x'], layerId, () => close());
        this.bindInteractionKey(modal, ['a'], layerId, async () => editOffer(null));
        this.bindInteractionKey(list, ['a'], layerId, async () => editOffer(null));
        this.bindInteractionKey(modal, ['e'], layerId, async () => editOffer(getSelectedOffer()));
        this.bindInteractionKey(list, ['e'], layerId, async () => editOffer(getSelectedOffer()));
        this.bindInteractionKey(modal, ['t'], layerId, async () => toggleOffer());
        this.bindInteractionKey(list, ['t'], layerId, async () => toggleOffer());
        this.bindInteractionKey(modal, ['r'], layerId, async () => refreshOfferings());
        this.bindInteractionKey(list, ['r'], layerId, async () => refreshOfferings());

        list.on('select item', (_, index) => {
          renderDetails(index);
          this.screen.render();
        });

        this.screen.saveFocus();
        renderList();
        list.focus();
        list.select(0);
        renderDetails(0);
        this.screen.render();
      });

      if (managerResult && managerResult.changed) {
        await this.withLoading('Refreshing registrar summaries...', async () => {
          await this.refreshRegistrarsState();
        });
      }
    } catch (error) {
      this.setStatus(error.message, 'error');
    } finally {
      this.modalActive = false;
      this.screen.render();
    }
  }

  async openServicePackagePriceManager(registrar, servicePackage) {
    const loadedPrices = await this.withLoading(
      `Loading package pricing for ${servicePackage.package_name}...`,
      async () =>
        adminService.listRegistrarServicePackagePrices(registrar.id, servicePackage.id)
    );

    if (!loadedPrices) {
      return { changed: false };
    }

    let prices = loadedPrices;
    let changed = false;

    return new Promise((resolve) => {
      const layerId = this.openInteractionLayer();
      const modal = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '90%',
        height: '82%',
        border: 'line',
        label: ` Billing Options: ${servicePackage.package_name} `,
        style: {
          bg: 'black',
          fg: 'white',
          border: {
            fg: 'cyan',
          },
        },
      });

      const listPanel = blessed.box({
        parent: modal,
        top: 0,
        left: 0,
        width: '64%',
        bottom: 3,
        border: 'line',
        label: ' Prices ',
        style: {
          border: {
            fg: 'green',
          },
        },
      });

      const detailsPanel = blessed.box({
        parent: modal,
        top: 0,
        left: '64%',
        width: '36%',
        bottom: 3,
        border: 'line',
        label: ' Price Details ',
        alwaysScroll: true,
        keys: true,
        mouse: true,
        scrollable: true,
        vi: true,
        style: {
          border: {
            fg: 'yellow',
          },
        },
      });

      blessed.box({
        parent: modal,
        top: 0,
        left: 1,
        right: 1,
        height: 1,
        content: `${pad('Billing', 12)} ${pad('Label', 18)} ${pad('Price', 14)} ${pad('Default', 8)} ${pad('Status', 10)}`,
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
        alwaysScroll: true,
        keys: true,
        vi: true,
        mouse: true,
        scrollable: true,
        scrollbar: {
          ch: ' ',
          style: {
            bg: 'green',
          },
        },
        style: {
          selected: {
            bg: 'green',
            fg: 'black',
            bold: true,
          },
        },
        items: [],
      });

      const getSelectedPrice = () => {
        if (!prices.length) {
          return null;
        }

        return prices[Math.max(0, Math.min(list.selected || 0, prices.length - 1))];
      };

      const renderList = () => {
        list.setItems(
          prices.length
            ? prices.map(
                (price) =>
                  `${pad(formatBillingLabel(price.billing_cycle, price.billing_period_months), 12)} ${pad(price.billing_label || 'Auto', 18)} ${pad(formatCurrencyKsh(price.price_ksh), 14)} ${pad(price.is_default ? 'YES' : 'NO', 8)} ${pad(price.is_active ? 'ACTIVE' : 'INACTIVE', 10)}`
              )
            : ['No package pricing yet. Press "a" to add one.']
        );
      };

        const renderDetails = (selectedIndex) => {
          if (!prices.length) {
            detailsPanel.setContent(
              [
                '',
                ` Registrar: ${registrar.name}`,
                ` Package: ${servicePackage.package_name}`,
                ` Service: ${toDisplay(servicePackage.service_name)}`,
                '',
                ' No package pricing has been added yet.',
                '',
                ' Actions:',
              '  a  Add package pricing',
              '  r  Refresh list',
              '  x  Close manager',
            ].join('\n')
          );
          return;
        }

        const price = prices[selectedIndex];

        detailsPanel.setContent(
          [
            '',
            ` Package: ${servicePackage.package_name}`,
            ` Service: ${toDisplay(servicePackage.service_name)}`,
            ` Service Category: ${toDisplay(servicePackage.service_category)}`,
            ` Package Active: ${formatBoolean(servicePackage.is_active)}`,
            ` Billing: ${formatBillingLabel(price.billing_cycle, price.billing_period_months)}`,
            ` Billing Label: ${toDisplay(price.billing_label)}`,
            ` Billing Cycle: ${toDisplay(price.billing_cycle)}`,
            ` Billing Months: ${toDisplay(price.billing_period_months)}`,
            ` Price: ${formatCurrencyKsh(price.price_ksh)}`,
            ` Setup Fee: ${formatCurrencyKsh(price.setup_fee_ksh)}`,
            ` Currency: ${toDisplay(price.currency_code)}`,
            ` Default: ${formatBoolean(price.is_default)}`,
            ` Active: ${formatBoolean(price.is_active)}`,
            ` Updated At: ${formatDateTime(price.updated_at)}`,
            '',
              ' Actions:',
              '  a  Replace package pricing',
              '  e  Edit package pricing',
              '  D  Delete package pricing',
              '  t  Toggle active / inactive',
              '  r  Refresh list',
              '  x  Close manager',
          ].join('\n')
        );
      };

      const close = () => {
        modal.detach();
        this.screen.restoreFocus();
        this.closeInteractionLayer(layerId);
        this.screen.render();
        resolve({ changed });
      };

      const refreshPrices = async () => {
        const refreshed = await this.withLoading(
          `Refreshing package pricing for ${servicePackage.package_name}...`,
          async () =>
            adminService.listRegistrarServicePackagePrices(registrar.id, servicePackage.id)
        );

        if (!refreshed) {
          return;
        }

        prices = refreshed;
        renderList();
        if (prices.length) {
          list.select(Math.max(0, Math.min(list.selected || 0, prices.length - 1)));
          renderDetails(list.selected || 0);
        } else {
          renderDetails(0);
        }
        this.screen.render();
      };

      const editPrice = async (existingPrice = null) => {
        const draft = await this.openServicePackagePriceForm(
          registrar,
          servicePackage,
          existingPrice
        );

        if (!draft) {
          this.setStatus('Package pricing edit cancelled.', 'warning');
          return;
        }

        const savedPrices = await this.withLoading(
          existingPrice ? 'Updating package pricing...' : 'Saving package pricing...',
          async () =>
            adminService.saveRegistrarServicePackagePrice(
              registrar.id,
              servicePackage.id,
              draft
            )
        );

        if (!savedPrices) {
          return;
        }

        prices = savedPrices;
        changed = true;
        renderList();
        if (prices.length) {
          const nextIndex = existingPrice
            ? Math.max(0, prices.findIndex((price) => price.id === existingPrice.id))
            : prices.length - 1;
          list.select(nextIndex >= 0 ? nextIndex : 0);
          renderDetails(list.selected || 0);
        } else {
          renderDetails(0);
        }
        this.setStatus(`Saved package pricing for ${servicePackage.package_name}.`, 'success');
        this.screen.render();
      };

      const togglePrice = async () => {
        const selectedPrice = getSelectedPrice();

        if (!selectedPrice) {
          this.setStatus('Select package pricing first.', 'warning');
          return;
        }

        const confirmed = await this.askConfirmation(
          `Toggle ${formatBillingLabel(selectedPrice.billing_cycle, selectedPrice.billing_period_months)} to ${selectedPrice.is_active ? 'inactive' : 'active'}?`
        );

        if (!confirmed) {
          this.setStatus('Package pricing toggle cancelled.', 'warning');
          return;
        }

        const savedPrices = await this.withLoading(
          'Updating package pricing status...',
          async () =>
            adminService.toggleRegistrarServicePackagePriceActive(
              registrar.id,
              servicePackage.id,
              selectedPrice.id
            )
        );

        if (!savedPrices) {
          return;
        }

        prices = savedPrices;
        changed = true;
        renderList();
        if (prices.length) {
          list.select(Math.max(0, Math.min(list.selected || 0, prices.length - 1)));
          renderDetails(list.selected || 0);
        } else {
          renderDetails(0);
        }
        this.setStatus(`Updated package pricing status for ${servicePackage.package_name}.`, 'success');
        this.screen.render();
      };

      const deletePrice = async () => {
        const selectedPrice = getSelectedPrice();

        if (!selectedPrice) {
          this.setStatus('Select package pricing first.', 'warning');
          return;
        }

        const confirmed = await this.askConfirmation(
          `Delete ${formatBillingLabel(selectedPrice.billing_cycle, selectedPrice.billing_period_months)} pricing from ${servicePackage.package_name}?`
        );

        if (!confirmed) {
          this.setStatus('Package pricing delete cancelled.', 'warning');
          return;
        }

        const savedPrices = await this.withLoading(
          'Deleting package pricing...',
          async () =>
            adminService.deleteRegistrarServicePackagePrice(
              registrar.id,
              servicePackage.id,
              selectedPrice.id
            )
        );

        if (!savedPrices) {
          return;
        }

        prices = savedPrices;
        changed = true;
        renderList();
        if (prices.length) {
          list.select(Math.max(0, Math.min(list.selected || 0, prices.length - 1)));
          renderDetails(list.selected || 0);
        } else {
          renderDetails(0);
        }
        this.setStatus(`Deleted package pricing from ${servicePackage.package_name}.`, 'success');
        this.screen.render();
      };

      this.bindInteractionKey(modal, ['escape', 'x'], layerId, () => close());
      this.bindInteractionKey(detailsPanel, ['escape', 'x'], layerId, () => close());
      this.bindInteractionKey(list, ['escape', 'x'], layerId, () => close());
      this.bindInteractionKey(modal, ['a'], layerId, async () => editPrice(null));
      this.bindInteractionKey(list, ['a'], layerId, async () => editPrice(null));
      this.bindInteractionKey(modal, ['D'], layerId, async () => deletePrice());
      this.bindInteractionKey(list, ['D'], layerId, async () => deletePrice());
      this.bindInteractionKey(modal, ['e'], layerId, async () => editPrice(getSelectedPrice()));
      this.bindInteractionKey(list, ['e'], layerId, async () => editPrice(getSelectedPrice()));
      this.bindInteractionKey(modal, ['t'], layerId, async () => togglePrice());
      this.bindInteractionKey(list, ['t'], layerId, async () => togglePrice());
      this.bindInteractionKey(modal, ['r'], layerId, async () => refreshPrices());
      this.bindInteractionKey(list, ['r'], layerId, async () => refreshPrices());

      list.on('select item', (_, index) => {
        renderDetails(index);
        this.screen.render();
      });

      this.screen.saveFocus();
      renderList();
      list.focus();
      list.select(0);
      renderDetails(0);
      this.screen.render();
    });
  }

  async openServicePackageManager() {
    const registrar = this.getSelectedRegistrar();

    if (!registrar) {
      this.setStatus('Select a registrar first.', 'warning');
      return;
    }

    this.modalActive = true;

    try {
      const loadedData = await this.withLoading(
        `Loading packages for ${registrar.name}...`,
        async () =>
          Promise.all([
            adminService.listServiceProducts(),
            adminService.listRegistrarServicePackages(registrar.id),
          ])
      );

      if (!loadedData) {
        return;
      }

      const [serviceProducts, initialPackages] = loadedData;
      let packages = initialPackages;
      let changed = false;

      const managerResult = await new Promise((resolve) => {
        const layerId = this.openInteractionLayer();
        const modal = blessed.box({
          parent: this.screen,
          top: 'center',
          left: 'center',
          width: '92%',
          height: '86%',
          border: 'line',
          label: ` Packages: ${registrar.name} `,
          style: {
            bg: 'black',
            fg: 'white',
            border: {
              fg: 'cyan',
            },
          },
        });

        const listPanel = blessed.box({
          parent: modal,
          top: 0,
          left: 0,
          width: '64%',
          bottom: 3,
          border: 'line',
          label: ' Packages ',
          style: {
            border: {
              fg: 'green',
            },
          },
        });

        const detailsPanel = blessed.box({
          parent: modal,
          top: 0,
          left: '64%',
          width: '36%',
          bottom: 3,
          border: 'line',
          label: ' Package Details ',
          alwaysScroll: true,
          keys: true,
          mouse: true,
          scrollable: true,
          vi: true,
          style: {
            border: {
              fg: 'yellow',
            },
          },
        });

        blessed.box({
          parent: modal,
          top: 0,
          left: 1,
          right: 1,
          height: 1,
          content: `${pad('Service', 15)} ${pad('Package', 18)} ${pad('Default Billing', 14)} ${pad('Default Price', 14)} ${pad('Prices', 6)} ${pad('Status', 10)}`,
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
          alwaysScroll: true,
          keys: true,
          vi: true,
          mouse: true,
          scrollable: true,
          scrollbar: {
            ch: ' ',
            style: {
              bg: 'green',
            },
          },
          style: {
            selected: {
              bg: 'green',
              fg: 'black',
              bold: true,
            },
          },
          items: [],
        });

        const getSelectedPackage = () => {
          if (!packages.length) {
            return null;
          }

          return packages[Math.max(0, Math.min(list.selected || 0, packages.length - 1))];
        };

        const renderList = () => {
          list.setItems(
            packages.length
              ? packages.map(
                  (servicePackage) =>
                    `${pad(servicePackage.service_name || '—', 15)} ${pad(servicePackage.package_name || '—', 18)} ${pad(formatPackageDefaultBilling(servicePackage), 14)} ${pad(formatPackageDefaultPrice(servicePackage), 14)} ${pad(servicePackage.price_count, 6)} ${pad(servicePackage.is_active ? 'ACTIVE' : 'INACTIVE', 10)}`
                )
              : ['No packages yet. Press "a" to add one.']
          );
        };

        const renderDetails = (selectedIndex) => {
          if (!packages.length) {
            detailsPanel.setContent(
              [
                '',
                ` Registrar: ${registrar.name}`,
                '',
                ' No service packages have been added yet.',
                ...(serviceProducts.length
                  ? []
                  : [
                      '',
                      ' No service products are configured yet.',
                      ' Packages need a service before they can be created.',
                    ]),
                '',
                ' Actions:',
                '  a  Add a package',
                '  r  Refresh list',
                '  x  Close manager',
              ].join('\n')
            );
            return;
          }

          const servicePackage = packages[selectedIndex];

          detailsPanel.setContent(
            [
              '',
              ` Service: ${servicePackage.service_name}`,
              ` Service Category: ${toDisplay(servicePackage.service_category)}`,
              ` Package Name: ${servicePackage.package_name}`,
              ` Package Code: ${servicePackage.package_code}`,
              ` Short Description: ${toDisplay(servicePackage.short_description)}`,
              ` Display Order: ${toDisplay(servicePackage.display_order)}`,
              ` Default Price: ${formatPackageDefaultPrice(servicePackage)}`,
              ` Default Billing: ${formatPackageDefaultBilling(servicePackage)}`,
              ` Default Currency: ${toDisplay(servicePackage.default_currency_code)}`,
              ` Active Pricing Records: ${toDisplay(servicePackage.active_price_count)}`,
              ` Total Pricing Records: ${toDisplay(servicePackage.price_count)}`,
              ` Feature Highlights: ${formatFeatureHighlights(servicePackage.feature_bullets_json)}`,
              ` Details JSON: ${formatJson(servicePackage.details_json)}`,
              ` Active: ${formatBoolean(servicePackage.is_active)}`,
              ` Updated At: ${formatDateTime(servicePackage.updated_at)}`,
              '',
              ' Actions:',
              '  a  Add another package',
              '  d  Delete selected package',
              '  e  Edit selected package',
              '  v  Manage package pricing',
              '  t  Toggle active / inactive',
              '  r  Refresh list',
              '  x  Close manager',
            ].join('\n')
          );
        };

        const close = () => {
          modal.detach();
          this.screen.restoreFocus();
          this.closeInteractionLayer(layerId);
          this.screen.render();
          resolve({ changed });
        };

        const refreshPackages = async () => {
          const refreshed = await this.withLoading(
            `Refreshing packages for ${registrar.name}...`,
            async () => adminService.listRegistrarServicePackages(registrar.id)
          );

          if (!refreshed) {
            return;
          }

          packages = refreshed;
          renderList();
          if (packages.length) {
            list.select(Math.max(0, Math.min(list.selected || 0, packages.length - 1)));
            renderDetails(list.selected || 0);
          } else {
            renderDetails(0);
          }
          this.screen.render();
        };

        const editPackage = async (existingPackage = null) => {
          if (!serviceProducts.length) {
            this.setStatus('No service products are configured yet, so packages cannot be created.', 'warning');
            return;
          }

          const draft = await this.openServicePackageForm(
            registrar,
            serviceProducts,
            existingPackage
          );

          if (!draft) {
            this.setStatus('Package edit cancelled.', 'warning');
            return;
          }

          const savedPackages = await this.withLoading(
            existingPackage ? 'Updating package...' : 'Creating package...',
            async () => adminService.saveRegistrarServicePackage(registrar.id, draft)
          );

          if (!savedPackages) {
            return;
          }

          packages = savedPackages;
          changed = true;
          renderList();
          if (packages.length) {
            const nextIndex = existingPackage
              ? Math.max(0, packages.findIndex((item) => item.id === existingPackage.id))
              : packages.length - 1;
            list.select(nextIndex >= 0 ? nextIndex : 0);
            renderDetails(list.selected || 0);
          } else {
            renderDetails(0);
          }
          this.setStatus(`Saved package for ${registrar.name}.`, 'success');
          this.screen.render();
        };

        const togglePackage = async () => {
          const selectedPackage = getSelectedPackage();

          if (!selectedPackage) {
            this.setStatus('Select a package first.', 'warning');
            return;
          }

          const confirmed = await this.askConfirmation(
            `Toggle ${selectedPackage.package_name} to ${selectedPackage.is_active ? 'inactive' : 'active'}?`
          );

          if (!confirmed) {
            this.setStatus('Package toggle cancelled.', 'warning');
            return;
          }

          const savedPackages = await this.withLoading(
            'Updating package status...',
            async () =>
              adminService.toggleRegistrarServicePackageActive(
                registrar.id,
                selectedPackage.id
              )
          );

          if (!savedPackages) {
            return;
          }

          packages = savedPackages;
          changed = true;
          renderList();
          if (packages.length) {
            list.select(Math.max(0, Math.min(list.selected || 0, packages.length - 1)));
            renderDetails(list.selected || 0);
          } else {
            renderDetails(0);
          }
          this.setStatus(`Updated package status for ${registrar.name}.`, 'success');
          this.screen.render();
        };

        const deletePackage = async () => {
          const selectedPackage = getSelectedPackage();

          if (!selectedPackage) {
            this.setStatus('Select a package first.', 'warning');
            return;
          }

          const confirmed = await this.askConfirmation(
            `Delete ${selectedPackage.package_name} and its ${selectedPackage.price_count || 0} pricing record(s)?`
          );

          if (!confirmed) {
            this.setStatus('Package delete cancelled.', 'warning');
            return;
          }

          const savedPackages = await this.withLoading(
            'Deleting package...',
            async () =>
              adminService.deleteRegistrarServicePackage(
                registrar.id,
                selectedPackage.id
              )
          );

          if (!savedPackages) {
            return;
          }

          packages = savedPackages;
          changed = true;
          renderList();
          if (packages.length) {
            list.select(Math.max(0, Math.min(list.selected || 0, packages.length - 1)));
            renderDetails(list.selected || 0);
          } else {
            renderDetails(0);
          }
          this.setStatus(`Deleted package from ${registrar.name}.`, 'success');
          this.screen.render();
        };

        const managePrices = async () => {
          const selectedPackage = getSelectedPackage();

          if (!selectedPackage) {
            this.setStatus('Select a package first.', 'warning');
            return;
          }

          const priceManagerResult = await this.openServicePackagePriceManager(
            registrar,
            selectedPackage
          );

          if (priceManagerResult && priceManagerResult.changed) {
            changed = true;
            await refreshPackages();
          }
        };

        this.bindInteractionKey(modal, ['escape', 'x'], layerId, () => close());
        this.bindInteractionKey(detailsPanel, ['escape', 'x'], layerId, () => close());
        this.bindInteractionKey(list, ['escape', 'x'], layerId, () => close());
        this.bindInteractionKey(modal, ['a'], layerId, async () => editPackage(null));
        this.bindInteractionKey(list, ['a'], layerId, async () => editPackage(null));
        this.bindInteractionKey(modal, ['d'], layerId, async () => deletePackage());
        this.bindInteractionKey(list, ['d'], layerId, async () => deletePackage());
        this.bindInteractionKey(modal, ['e'], layerId, async () => editPackage(getSelectedPackage()));
        this.bindInteractionKey(list, ['e'], layerId, async () => editPackage(getSelectedPackage()));
        this.bindInteractionKey(modal, ['v'], layerId, async () => managePrices());
        this.bindInteractionKey(list, ['v'], layerId, async () => managePrices());
        this.bindInteractionKey(modal, ['t'], layerId, async () => togglePackage());
        this.bindInteractionKey(list, ['t'], layerId, async () => togglePackage());
        this.bindInteractionKey(modal, ['r'], layerId, async () => refreshPackages());
        this.bindInteractionKey(list, ['r'], layerId, async () => refreshPackages());

        list.on('select item', (_, index) => {
          renderDetails(index);
          this.screen.render();
        });

        this.screen.saveFocus();
        renderList();
        list.focus();
        list.select(0);
        renderDetails(0);
        this.screen.render();
      });

      if (managerResult && managerResult.changed) {
        await this.withLoading('Refreshing registrar summaries...', async () => {
          await this.refreshRegistrarsState();
        });
      }
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

  async showPortalKeyModal(keyResult) {
    return new Promise((resolve) => {
      const layerId = this.openInteractionLayer();
      const infoLines = [
        `Registrar: ${keyResult.registrar.name} (${keyResult.registrar.registrarCode})`,
        `Label: ${keyResult.keyLabel}`,
        `Prefix: ${keyResult.keyPrefix}`,
        `Expires: ${formatDateTime(keyResult.expiresAt)}`,
        'Store this full key now. It will not be shown again after you close this dialog.',
      ];

      if (keyResult.portalAccessUrl) {
        infoLines.push(`Portal URL: ${keyResult.portalAccessUrl}`);
      }

      if (keyResult.note) {
        infoLines.push(keyResult.note);
      }

      if (keyResult.rotatedCount) {
        infoLines.push(`Previous active keys revoked: ${keyResult.rotatedCount}`);
      }

      const infoHeight = infoLines.length + 1;
      const keyTop = infoHeight + 1;
      const modalHeight = Math.max(15, keyTop + 6);

      const modal = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '72%',
        height: modalHeight,
        border: 'line',
        label: ' Registrar API Key ',
        keys: true,
        mouse: true,
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
        height: infoHeight,
        content: infoLines.join('\n'),
        style: {
          fg: 'white',
        },
      });

      blessed.box({
        parent: modal,
        top: keyTop,
        left: 2,
        right: 2,
        height: 3,
        padding: {
          left: 1,
          right: 1,
        },
        border: 'line',
        content: keyResult.apiKey,
        style: {
          fg: 'black',
          bg: 'green',
          border: {
            fg: 'green',
          },
        },
      });

      blessed.box({
        parent: modal,
        bottom: 1,
        left: 2,
        right: 2,
        height: 2,
        align: 'center',
        content: 'Press Enter, Escape, or x to close this key view.',
        style: {
          fg: 'yellow',
        },
      });

      const close = () => {
        modal.detach();
        this.screen.restoreFocus();
        this.closeInteractionLayer(layerId);
        this.screen.render();
        resolve();
      };

      this.bindInteractionKey(modal, ['enter', 'escape', 'x'], layerId, () => close());
      this.screen.saveFocus();
      modal.focus();
      this.screen.render();
    });
  }

  async createPortalKeyForSelectedRegistrar() {
    const registrar = this.getSelectedRegistrar();

    if (!registrar) {
      this.setStatus('Select a registrar first.', 'warning');
      return;
    }

    let activeStepIndex = 0;
    let progress = null;

    try {
      const confirmed = await this.askConfirmation(
        `Generate a new registrar API key for "${registrar.name}"?`
      );

      if (!confirmed) {
        this.setStatus('API key generation cancelled.', 'warning');
        return;
      }

      progress = this.openWorkflowProgressModal({
        title: 'Generate Registrar API Key',
        summary: `Generating a new API key for ${registrar.name}. The previous active key will be revoked and the registrar will receive the replacement key by email.`,
        steps: [
          'Generate a new registrar API key',
          'Send registrar API key email',
          'Refresh registrar management view',
        ],
      });
      let keyResult = null;

      progress.startStep(0, `Issuing a replacement API key for ${registrar.name}...`);
      keyResult = await adminService.createRegistrarPortalApiKey(registrar.id, {
        credentialEmailType: 'reissue',
        sendCredentialEmail: false,
      });

      if (!keyResult || !keyResult.apiKey) {
        throw new Error('The new registrar API key could not be created.');
      }

      progress.completeStep(
        0,
        `New API key ready with prefix ${toDisplay(keyResult.keyPrefix)}.`
      );

      activeStepIndex = 1;
      progress.startStep(1, `Sending the new API key to ${toDisplay(registrar.primary_email)}...`);
      const emailDelivery = await adminService.sendRegistrarPortalCredentialEmail(
        registrar.id,
        keyResult.apiKey,
        { emailType: 'reissue' }
      );
      const emailNote =
        buildEmailDeliveryNote(emailDelivery, 'Registrar API key email') ||
        'Registrar API key email delivery completed.';

      keyResult = {
        ...keyResult,
        emailDelivery,
        note: emailNote,
      };

      if (emailDelivery && emailDelivery.status === 'sent') {
        progress.completeStep(1, emailNote);
      } else {
        progress.warnStep(1, emailNote);
      }

      activeStepIndex = 2;
      progress.startStep(2, 'Refreshing registrar summaries and key details...');
      await this.refreshRegistrarsState();
      this.renderView();
      progress.completeStep(
        2,
        `Registrar ${registrar.name} now shows the latest API key metadata in the management view.`
      );
      progress.setSummary(`A new registrar API key is ready for ${registrar.name}.`);
      progress.setClosable();
      progress.close();
      progress = null;

      if (!keyResult) {
        return;
      }

      this.rememberVisiblePortalKey(keyResult);
      this.renderView();
      this.screen.render();
      await this.showPortalKeyModal(keyResult);
      this.setStatus(
        `Generated a new API key for "${registrar.name}".${keyResult.note ? ` ${keyResult.note}` : ''}`,
        keyResult.emailDelivery && keyResult.emailDelivery.status === 'sent'
          ? 'success'
          : 'warning'
      );
    } catch (error) {
      if (progress) {
        progress.failStep(activeStepIndex, error.message);
        progress.setSummary(`API key generation stopped: ${error.message}`);
        progress.setClosable();
        progress.close();
      }
      this.setStatus(error.message, 'error');
    }
  }

  async deleteSelectedRegistrar() {
    const registrar = this.getSelectedRegistrar();

    if (!registrar) {
      this.setStatus('Select a registrar first.', 'warning');
      return;
    }

    try {
      const impact = await this.withLoading(
        `Inspecting deletion impact for ${registrar.name}...`,
        async () => adminService.getRegistrarDeletionImpact(registrar.id)
      );

      if (!impact) {
        return;
      }

      const typedPhrase = await this.openDangerPhrasePrompt({
        title: `Delete Registrar: ${registrar.name}`,
        lines: buildRegistrarDeletionImpactLines(impact),
        phrase: REGISTRAR_DELETE_CONFIRMATION_PHRASE,
      });

      if (!typedPhrase) {
        this.setStatus('Registrar deletion cancelled.', 'warning');
        return;
      }

      if (typedPhrase.trim().toUpperCase() !== REGISTRAR_DELETE_CONFIRMATION_PHRASE) {
        this.setStatus(
          `Registrar deletion cancelled. Type ${REGISTRAR_DELETE_CONFIRMATION_PHRASE} to continue.`,
          'warning'
        );
        return;
      }

      const progress = this.openWorkflowProgressModal({
        title: 'Delete Registrar',
        summary: `Deleting ${registrar.name}. The system will archive the registrar snapshot first, then remove the live registrar and refresh the management view.`,
        steps: [
          'Archive registrar deletion snapshot',
          'Delete live registrar records',
          'Refresh registrar management view',
        ],
      });

      let deletionResult = null;
      let activeStepIndex = 0;

      try {
        progress.startStep(
          0,
          'Writing the registrar profile and catalog snapshot to registrar_deletion_audit...'
        );

        deletionResult = await adminService.deleteRegistrar(registrar.id, {
          actorId: 'admin',
          actorType: 'checkout_admin_tui',
          confirmationPhrase: typedPhrase,
        });

        progress.completeStep(
          0,
          `Snapshot archived under ${deletionResult.archiveId}.`
        );

        activeStepIndex = 1;
        progress.startStep(
          1,
          'Deleting the live registrar profile, catalog records, and portal access data...'
        );
        progress.completeStep(
          1,
          `Registrar ${registrar.name} and its live catalog and access records were removed.`
        );

        activeStepIndex = 2;
        progress.startStep(2, 'Refreshing the registrar management view...');
        await this.refreshRegistrarsState();
        delete this.state.visiblePortalKeys[registrar.id];
        this.renderView();
        progress.completeStep(
          2,
          'Registrar management view refreshed successfully.'
        );
        progress.setSummary(
          `Registrar ${registrar.name} was deleted. Historical registrations and registrar requests were preserved but detached from the deleted registrar.`
        );
        progress.setClosable();
        progress.close();

        this.setStatus(
          `Deleted registrar "${registrar.name}". Archive ${deletionResult.archiveId} was stored before removal.`,
          'success'
        );
      } catch (error) {
        progress.failStep(activeStepIndex, error.message);
        progress.setSummary(`Registrar deletion stopped: ${error.message}`);
        progress.setClosable();
        progress.close();
        throw error;
      }
    } catch (error) {
      this.setStatus(error.message, 'error');
    }
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
