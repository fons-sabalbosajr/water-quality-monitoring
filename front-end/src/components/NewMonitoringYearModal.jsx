import { useMemo, useState } from 'react';
import { Alert, Modal, Select, Space, Tag, Transfer, Typography } from 'antd';
import { CalendarOutlined } from '@ant-design/icons';
import {
  WQM_YEAR_OPTIONS,
  buildBlankYearSheets,
  buildWaterbodyOptions,
  createTabularYear,
  getAllTabularYears,
  groupWaterbodyByProvince,
} from '../utils/wqmSheets';
import { toastSaved, alertError } from '../utils/swal';

const { Text } = Typography;

/**
 * Lets an admin/developer create a brand-new monitoring-year template (e.g.
 * 2027) by picking a base year and the waterbodies/stations to include. The new
 * year is seeded with the chosen waterbodies' station structure and empty
 * monthly readings.
 *
 * Inner form. Mounted only while the modal is open (matching `destroyOnHidden`),
 * so every open starts from freshly computed state via the useState initialisers
 * instead of an effect that syncs to the `open` prop. That is what guarantees the
 * year selector cannot show a year that was created during the previous open.
 */
const NewYearForm = ({ sourceSheets, onClose, onCreated }) => {
  const [existingYears, setExistingYears] = useState(getAllTabularYears);

  const waterbodies = useMemo(
    () => buildWaterbodyOptions(sourceSheets || []),
    [sourceSheets],
  );

  const transferData = useMemo(
    () =>
      groupWaterbodyByProvince(waterbodies).flatMap(({ province, items }) =>
        items.map((wb) => ({
          key: wb.key,
          title: wb.name,
          description: province,
          province,
        })),
      ),
    [waterbodies],
  );

  const yearOptions = useMemo(() => {
    const base = new Date().getFullYear();
    const taken = new Set([...existingYears, ...WQM_YEAR_OPTIONS]);
    const options = [];
    for (let y = base; y <= base + 6; y += 1) {
      if (!taken.has(y)) options.push({ value: y, label: String(y) });
    }
    return options;
  }, [existingYears]);

  // First year that is actually selectable, computed once on mount.
  const [year, setYear] = useState(() => {
    const taken = new Set([...getAllTabularYears(), ...WQM_YEAR_OPTIONS]);
    const base = new Date().getFullYear();
    for (let y = base; y <= base + 6; y += 1) {
      if (!taken.has(y)) return y;
    }
    return null;
  });
  // Pre-select every waterbody so a new year mirrors the full standard template.
  const [targetKeys, setTargetKeys] = useState(
    () => buildWaterbodyOptions(sourceSheets || []).map((wb) => wb.key),
  );
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const handleClose = () => {
    setError('');
    setCreating(false);
    onClose();
  };

  const handleCreate = () => {
    if (creating) return;
    const numericYear = Number(year);
    if (!Number.isInteger(numericYear) || numericYear < 2000 || numericYear > 2100) {
      setError('Select a monitoring year to create.');
      return;
    }
    // Re-check against storage rather than the snapshot: another tab may have
    // created this year since the modal opened.
    if (getAllTabularYears().includes(numericYear)) {
      setError(`Monitoring year ${numericYear} already exists.`);
      setExistingYears(getAllTabularYears());
      return;
    }
    if (!targetKeys.length) {
      setError('Select at least one waterbody to include in the new monitoring plan.');
      return;
    }
    const sheets = buildBlankYearSheets(sourceSheets || [], targetKeys);
    if (!sheets.length) {
      setError('No waterbody structure could be built from the selection. The selected waterbodies have no station records to copy.');
      return;
    }

    setCreating(true);
    let ok;
    try {
      ok = createTabularYear(numericYear, sheets);
    } catch (err) {
      // Storage quota is the realistic failure here — a year template holds
      // every station for every selected waterbody.
      setCreating(false);
      alertError(
        'Could not create the new monitoring year.',
        err?.name === 'QuotaExceededError'
          ? 'Browser storage is full. Remove an unused monitoring year and try again.'
          : err?.message || '',
      );
      return;
    }
    if (!ok) {
      setCreating(false);
      alertError('Could not create the new monitoring year.');
      return;
    }
    const stationCount = sheets.reduce((sum, sheet) => sum + (sheet.stations?.length || 0), 0);
    toastSaved(`Monitoring year ${numericYear} created — ${sheets.length} waterbodies, ${stationCount} stations.`);
    handleClose();
    onCreated?.(numericYear);
  };

  return (
    <Modal
      open
      onCancel={handleClose}
      onOk={handleCreate}
      okText="Create Monitoring Year"
      confirmLoading={creating}
      // Guards the two states that previously only failed after clicking.
      okButtonProps={{ disabled: !year || !targetKeys.length || !yearOptions.length }}
      title={(
        <Space>
          <CalendarOutlined />
          <span>New Monitoring Year Template</span>
        </Space>
      )}
      width={720}
      destroyOnHidden
    >
      <Space orientation="vertical" size="middle" style={{ width: '100%', marginTop: 8 }}>
        <Alert
          type="info"
          showIcon
          title="Create a fresh monitoring plan for a future year by selecting the waterbodies and stations to carry over. Readings start empty and can be encoded in the Tabular Results."
        />
        <div>
          <Text strong>Monitoring Year</Text>
          <div style={{ marginTop: 6 }}>
            <Select
              showSearch
              value={year}
              style={{ width: 200, maxWidth: '100%' }}
              onChange={(value) => { setYear(value); setError(''); }}
              options={yearOptions}
              placeholder={yearOptions.length ? 'Select year' : 'No years available'}
              disabled={!yearOptions.length}
              notFoundContent="Every year in range already has a template."
            />
            {!yearOptions.length && (
              <Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
                Templates already exist for every year through{' '}
                {new Date().getFullYear() + 6}. Delete an unused monitoring year first.
              </Text>
            )}
          </div>
        </div>
        <div>
          <Text strong>Waterbodies &amp; Stations to include</Text>
          <Tag color="blue" style={{ marginInlineStart: 8 }}>{targetKeys.length} selected</Tag>
          <div style={{ marginTop: 6 }}>
            {/* listStyle was a fixed 310px per panel (~680px with the arrows),
                which overflowed the modal below ~720px. A flexible width lets
                the two panels share whatever the modal actually has. */}
            <Transfer
              className="new-year-transfer"
              dataSource={transferData}
              targetKeys={targetKeys}
              onChange={(keys) => { setTargetKeys(keys); setError(''); }}
              render={(item) => `${item.title} · ${item.province}`}
              titles={['Available', 'Included']}
              listStyle={{ width: '100%', height: 320 }}
              showSearch
              filterOption={(input, item) =>
                item.title.toLowerCase().includes(input.toLowerCase()) ||
                item.province.toLowerCase().includes(input.toLowerCase())
              }
              locale={{
                itemUnit: 'waterbody',
                itemsUnit: 'waterbodies',
                notFoundContent: 'No waterbodies with station records',
              }}
            />
          </div>
        </div>
        {error && <Alert type="error" showIcon title={error} />}
      </Space>
    </Modal>
  );
};

/**
 * Mounts the form only while open so its state is rebuilt from scratch on every
 * open. `destroyOnHidden` on the Modal handles the exit animation.
 */
const NewMonitoringYearModal = ({ open, onClose, sourceSheets, onCreated }) => {
  if (!open) return null;
  return (
    <NewYearForm
      sourceSheets={sourceSheets}
      onClose={onClose}
      onCreated={onCreated}
    />
  );
};

export default NewMonitoringYearModal;
