// Developer Manager → VERA Assistant. Developer-only settings for VERA's model,
// permissions and limits. The API key is never shown or editable here — only
// whether the server has one (GEMINI_API_KEY in the server environment).

import { useCallback, useEffect, useState } from 'react';
import { Alert, AutoComplete, Button, InputNumber, Select, Slider, Space, Switch, Tag } from 'antd';
import { ApiOutlined, CheckCircleOutlined, CloseCircleOutlined, MessageOutlined, SaveOutlined } from '@ant-design/icons';
import api from '../../api/axios';
import { toastSaved, alertError } from '../../utils/swal';
import { logActivity } from '../../utils/appLog';
import VeraFlameIcon from './VeraFlameIcon';

const Row = ({ label, hint, children }) => (
  <div className="vera-settings-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 260px) 1fr', gap: 16, alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
    <div>
      <div style={{ fontWeight: 600 }}>{label}</div>
      {hint && <div className="section-desc" style={{ margin: '2px 0 0', fontSize: '0.8rem' }}>{hint}</div>}
    </div>
    <div style={{ minWidth: 0 }}>{children}</div>
  </div>
);

export default function VeraSettingsPanel({ currentUser }) {
  const [meta, setMeta] = useState(null);
  const [draft, setDraft] = useState(null);
  const [models, setModels] = useState([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(() => {
    api.get('/vera/settings')
      .then(({ data }) => {
        setMeta(data);
        setDraft(data.settings);
        setModels(data.modelSuggestions || []);
      })
      .catch((err) => setLoadError(err?.response?.data?.message || 'Could not load VERA settings.'));
    api.get('/vera/settings/models')
      .then(({ data }) => { if (data?.models?.length) setModels(data.models); })
      .catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      const { enabled, allowCrud, provider, model, temperature, maxOutputTokens, dailyLimitPerUser, requestTimeoutMs } = draft;
      const { data } = await api.patch('/vera/settings', { enabled, allowCrud, provider, model, temperature, maxOutputTokens, dailyLimitPerUser, requestTimeoutMs });
      setDraft(data.settings);
      setMeta((m) => ({ ...m, settings: data.settings }));
      toastSaved('VERA settings saved.');
      logActivity('Updated VERA settings', { provider, model, enabled, allowCrud }, currentUser);
    } catch (err) {
      alertError(err?.response?.data?.message || 'Failed to save VERA settings.');
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await api.post('/vera/settings/test', { model: draft.model }, { timeout: 20000 });
      setTestResult({ ok: true, text: `${data.model} answered in ${data.latencyMs} ms.` });
    } catch (err) {
      setTestResult({ ok: false, text: err?.response?.data?.message || 'Connection test failed.' });
    } finally {
      setTesting(false);
    }
  };

  if (loadError) return <Alert type="error" showIcon message={loadError} />;
  if (!draft) return <div className="app-loading compact"><span />Loading VERA settings…</div>;

  const modelMode = draft.enabled && draft.provider === 'gemini' && meta?.keyConfigured;
  const dirty = JSON.stringify(draft) !== JSON.stringify(meta?.settings);

  return (
    <div className="vera-settings">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 12, background: 'linear-gradient(135deg, #14243b 0%, #1a3353 60%, #0958d9 160%)', color: '#fff', marginBottom: 16 }}>
        <span style={{ width: 44, height: 44, borderRadius: '50%', background: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <VeraFlameIcon size={28} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>VERA — Virtual Environmental Response Assistant</div>
          <div style={{ fontSize: 12.5, opacity: 0.9 }}>
            {draft.enabled ? (modelMode ? `Online · ${draft.model}` : 'Online · Rule-based data assistant (no model)') : 'Turned off for all users'}
          </div>
        </div>
        <Button icon={<MessageOutlined />} onClick={() => window.dispatchEvent(new CustomEvent('vera:open', { detail: { ask: 'Which waterbodies have the most guideline failures?' } }))}>
          Try VERA
        </Button>
      </div>

      <Row label="Enable VERA" hint="Shows the Ask VERA assistant to every signed-in user.">
        <Switch checked={draft.enabled} onChange={set('enabled')} />
      </Row>
      <Row label="Allow data changes" hint="Admins and developers can ask VERA to edit readings, sampling dates and stations. Every change needs their explicit Confirm.">
        <Switch checked={draft.allowCrud} onChange={set('allowCrud')} />
      </Row>
      <Row label="Provider" hint="Rule-based mode answers the common data questions without a model.">
        <Select
          value={draft.provider}
          onChange={set('provider')}
          style={{ width: 260 }}
          options={[{ value: 'gemini', label: 'Google Gemini' }, { value: 'none', label: 'Rule-based only (no model)' }]}
        />
      </Row>
      <Row label="Model" hint={models.length ? 'List from the models this API key can use.' : undefined}>
        <AutoComplete
          value={draft.model}
          onChange={set('model')}
          style={{ width: 320, maxWidth: '100%' }}
          options={models.map((m) => ({ value: m }))}
          filterOption={(input, option) => option.value.toLowerCase().includes(input.toLowerCase())}
          disabled={draft.provider !== 'gemini'}
        />
      </Row>
      <Row label="API key" hint="Set GEMINI_API_KEY in the server environment. The key is never sent to the browser.">
        <Space wrap>
          {meta?.keyConfigured
            ? <Tag icon={<CheckCircleOutlined />} color="success">Configured · {meta.keySource}</Tag>
            : <Tag icon={<CloseCircleOutlined />} color="error">Not configured</Tag>}
          <Button icon={<ApiOutlined />} loading={testing} disabled={!meta?.keyConfigured || draft.provider !== 'gemini'} onClick={test}>
            Test connection
          </Button>
          {testResult && <Tag color={testResult.ok ? 'success' : 'error'}>{testResult.text}</Tag>}
        </Space>
      </Row>
      <Row label="Temperature" hint="Lower is more literal. VERA's figures always come from tools, not the model.">
        <Slider min={0} max={1} step={0.05} value={draft.temperature} onChange={set('temperature')} style={{ maxWidth: 320 }} disabled={draft.provider !== 'gemini'} />
      </Row>
      <Row label="Max answer length" hint="Output tokens per reply.">
        <InputNumber min={256} max={8192} step={128} value={draft.maxOutputTokens} onChange={set('maxOutputTokens')} />
      </Row>
      <Row label="Daily limit per user" hint="Questions per user per day.">
        <InputNumber min={1} max={5000} value={draft.dailyLimitPerUser} onChange={set('dailyLimitPerUser')} />
      </Row>
      <Row label="Request timeout" hint="Seconds before an answer is abandoned.">
        <InputNumber min={5} max={120} value={Math.round(draft.requestTimeoutMs / 1000)} onChange={(v) => set('requestTimeoutMs')((Number(v) || 30) * 1000)} addonAfter="s" />
      </Row>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
        <span className="section-desc" style={{ margin: 0 }}>
          {meta?.settings?.updatedAt ? `Last saved ${new Date(meta.settings.updatedAt).toLocaleString()}` : 'Using default settings.'}
        </span>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!dirty} onClick={save}>Save VERA settings</Button>
      </div>

      <Alert
        style={{ marginTop: 16 }}
        type="info"
        showIcon
        message="How VERA stays accurate"
        description="Every figure VERA reports is computed on the server from the stored WQM years (readings, exceedances against the dashboard guidelines, multi-year averages, and forecasts with the dashboard engine and the admin Forecast Horizon). The model only chooses which calculation to run and phrases the result; without a model VERA runs the same calculations through its rule-based router. Data changes are proposals that apply only after the admin confirms, and are rejected if the value changed in the meantime."
      />
    </div>
  );
}
