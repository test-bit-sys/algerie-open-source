/**
 * Authorization editor shared by requests, folders and collections.
 * Values accept {{variables}}. Secrets are masked until revealed.
 */
import { h, fill, domId } from '../lib/dom.js';
import { icon } from './icons.js';
import { createVarInput } from './var-input.js';
import { toast } from './toast.js';
import { fetchToken } from '../core/oauth.js';

const LABELS = {
  inherit: 'Inherit auth from parent',
  none: 'No Auth',
  bearer: 'Bearer Token',
  basic: 'Basic Auth',
  apikey: 'API Key',
  oauth2: 'OAuth 2.0',
  awsv4: 'AWS Signature',
};

const DESCRIPTIONS = {
  inherit: 'Uses the authorization of the folder or collection this request belongs to.',
  none: 'This request does not send any authorization.',
  bearer: 'Sends an Authorization header with a bearer token.',
  basic: 'Sends a username and password encoded in an Authorization header.',
  apikey: 'Sends a key and value as a header or a query parameter.',
  oauth2: 'Sends an access token. You can paste one or request a new one from a token endpoint.',
  awsv4: 'Signs the request with AWS Signature Version 4 when it is sent. The body is part of the signature.',
};

/**
 * opts: { auth, onChange(auth), vars, allowInherit, inheritFrom: () => ({ name, type }) | null, app, readOnly }
 */
export function createAuthEditor({ auth, onChange, vars, allowInherit = true, inheritFrom = null, app = null, readOnly = false }) {
  let state = structuredClone(auth);
  const typeId = domId('auth-type');
  const select = h(
    'select.select#' + typeId,
    { disabled: readOnly, onchange: (e) => { state.type = e.target.value; emit(); renderFields(); } },
    Object.entries(LABELS)
      .filter(([k]) => allowInherit || k !== 'inherit')
      .map(([k, label]) => h('option', { value: k, selected: state.type === k }, label)),
  );
  const desc = h('p');
  const fields = h('div.auth-fields');
  const el = h('div.auth-grid', h('div.auth-side', h('label.field-label', { for: typeId }, 'Auth type'), select, desc), fields);

  function emit() {
    onChange?.(structuredClone(state));
  }

  function field(label, group, key, { secret = false, placeholder = '' } = {}) {
    const id = domId('auth');
    let revealed = false;
    const input = createVarInput({
      value: state[group][key] || '',
      placeholder,
      labelledBy: `${id}-label`,
      vars,
      readOnly,
      className: `field-input${secret ? '.masked' : ''}`,
      onInput: (v) => {
        state[group][key] = v;
        emit();
      },
    });
    const toggle = secret
      ? h(
          'button.icon-btn.sm',
          {
            type: 'button',
            'aria-label': `Show ${label.toLowerCase()}`,
            'aria-pressed': 'false',
            onclick: () => {
              revealed = !revealed;
              input.el.classList.toggle('masked', !revealed);
              toggle.setAttribute('aria-pressed', String(revealed));
              toggle.setAttribute('aria-label', `${revealed ? 'Hide' : 'Show'} ${label.toLowerCase()}`);
              fill(toggle, icon(revealed ? 'eyeOff' : 'eye', 14));
            },
          },
          icon('eye', 14),
        )
      : null;
    return h('div.field', h('span.field-label', { id: `${id}-label` }, label), h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, input.el, toggle));
  }

  function choice(label, group, key, options) {
    const id = domId('auth');
    return h(
      'div.field',
      h('label.field-label', { for: id }, label),
      h(
        'select.select',
        { id, disabled: readOnly, onchange: (e) => { state[group][key] = e.target.value; emit(); renderFields(); } },
        options.map(([v, l]) => h('option', { value: v, selected: state[group][key] === v }, l)),
      ),
    );
  }

  function renderFields() {
    desc.textContent = DESCRIPTIONS[state.type] || '';
    switch (state.type) {
      case 'inherit': {
        const from = inheritFrom?.();
        fill(
          fields,
          h(
            'div.auth-empty',
            icon('shield', 22),
            from
              ? h('div', 'This request uses ', h('strong', from.label), ' from ', h('strong', from.name), '.')
              : h('div', 'This request is not in a collection, so there is nothing to inherit. No authorization is sent.'),
          ),
        );
        break;
      }
      case 'none':
        fill(fields, h('div.auth-empty', icon('lockOpen', 22), h('div', 'No authorization is sent with this request.')));
        break;
      case 'bearer':
        fill(fields, field('Token', 'bearer', 'token', { secret: true, placeholder: 'Token' }));
        break;
      case 'basic':
        fill(fields, field('Username', 'basic', 'username', { placeholder: 'Username' }), field('Password', 'basic', 'password', { secret: true, placeholder: 'Password' }));
        break;
      case 'apikey':
        fill(
          fields,
          field('Key', 'apikey', 'key', { placeholder: 'X-API-Key' }),
          field('Value', 'apikey', 'value', { secret: true, placeholder: 'Value' }),
          choice('Add to', 'apikey', 'in', [['header', 'Header'], ['query', 'Query params']]),
        );
        break;
      case 'oauth2': {
        const getBtn = h('button.btn', { type: 'button', disabled: readOnly }, icon('key', 15), h('span', 'Get new access token'));
        getBtn.addEventListener('click', async () => {
          const o = state.oauth2;
          const r = vars?.resolve ? vars.resolve : (s) => s;
          getBtn.disabled = true;
          try {
            const token = await fetchToken(
              { grantType: o.grantType, tokenUrl: r(o.tokenUrl), clientId: r(o.clientId), clientSecret: r(o.clientSecret), scope: r(o.scope), username: r(o.username), password: r(o.password), clientAuth: o.clientAuth },
              app?.sendOptions?.() || {},
            );
            state.oauth2.accessToken = token.accessToken;
            emit();
            renderFields();
            toast({ kind: 'success', title: 'Access token received', text: token.expiresIn ? `It expires in ${token.expiresIn} seconds.` : '' });
          } catch (err) {
            toast({ kind: 'error', title: 'Could not get a token', text: err.message });
          } finally {
            getBtn.disabled = false;
          }
        });
        fill(
          fields,
          field('Access token', 'oauth2', 'accessToken', { secret: true, placeholder: 'Paste a token or get a new one below' }),
          field('Header prefix', 'oauth2', 'headerPrefix', { placeholder: 'Bearer' }),
          h('h3', { style: { margin: '8px 0 0', fontSize: '13px' } }, 'Get a new token'),
          choice('Grant type', 'oauth2', 'grantType', [['client_credentials', 'Client credentials'], ['password', 'Password credentials']]),
          field('Token URL', 'oauth2', 'tokenUrl', { placeholder: 'https://auth.example.com/oauth/token' }),
          field('Client ID', 'oauth2', 'clientId'),
          field('Client secret', 'oauth2', 'clientSecret', { secret: true }),
          state.oauth2.grantType === 'password' ? field('Username', 'oauth2', 'username') : null,
          state.oauth2.grantType === 'password' ? field('Password', 'oauth2', 'password', { secret: true }) : null,
          field('Scope', 'oauth2', 'scope', { placeholder: 'read write' }),
          choice('Send client credentials', 'oauth2', 'clientAuth', [['header', 'As Basic Auth header'], ['body', 'In the request body']]),
          h('div', getBtn),
        );
        break;
      }
      case 'awsv4':
        fill(
          fields,
          field('Access key', 'awsv4', 'accessKey', { placeholder: 'AKIA...' }),
          field('Secret key', 'awsv4', 'secretKey', { secret: true }),
          field('AWS region', 'awsv4', 'region', { placeholder: 'us-east-1' }),
          field('Service name', 'awsv4', 'service', { placeholder: 'Detected from the URL, for example s3 or execute-api' }),
          field('Session token', 'awsv4', 'sessionToken', { secret: true, placeholder: 'Only for temporary credentials' }),
        );
        break;
      default:
        fill(fields);
    }
  }

  renderFields();
  return {
    el,
    setAuth(next) {
      state = structuredClone(next);
      select.value = state.type;
      renderFields();
    },
    refresh: renderFields,
  };
}

export const AUTH_LABELS = LABELS;
