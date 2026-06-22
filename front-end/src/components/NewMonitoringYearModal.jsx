import { useEffect, useMemo, useState } from 'react';
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
 * Modal that lets an admin/developer create a brand-new monitoring-year
 * template (e.g. 2027) by picking a base year and the waterbodies/stations to
 * include. The new year is seeded with the chosen waterbodies' station
 * structure and empty monthly readings.
 */
const NewMonitoringYearModal = ({ open, onClose, sourceSheets, onCreated }) => {
  const existingYears = getAllTabularYears();
  const defaultYear = (Math.max(...existingYears, new Date().getFullYear()) + 1);
  const [year, setYear] = useState(defaultYear);
  const [targetKeys, setTargetKeys] = useState([]);
  const [error, setError] = useState('');

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

  const reset = () => {
    setYear(defaultYear);
    setTargetKeys([]);
    setError('');
  };

  // When the modal opens, pre-select every waterbody so the new monitoring year
  // mirrors the full standard 2026 template by default (the admin can still
  // deselect any waterbody before creating).
  useEffect(() => {
    if (open) {
      setTargetKeys(waterbodies.map((wb) => wb.key));
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleCreate = () => {
    const numericYear = Number(year);
    if (!Number.isInteger(numericYear) || numericYear < 2000 || numericYear > 2100) {
      setError('Enter a valid monitoring year between 2000 and 2100.');
      return;
    }
    if (existingYears.includes(numericYear)) {
      setError(`Monitoring year ${numericYear} already exists.`);
      return;
    }
    if (!targetKeys.length) {
      setError('Select at least one waterbody to include in the new monitoring plan.');
      return;
    }
    const sheets = buildBlankYearSheets(sourceSheets || [], targetKeys);
    if (!sheets.length) {
      setError('No waterbody structure could be built from the selection.');
      return;
    }
    const ok = createTabularYear(numericYear, sheets);
    if (!ok) {
      alertError('Could not create the new monitoring year.');
      return;
    }
    toastSaved(`Monitoring year ${numericYear} created with ${sheets.length} waterbodies.`);
    handleClose();
    onCreated?.(numericYear);
  };

  const yearOptions = useMemo(() => {
    const base = new Date().getFullYear();
    const set = new Set();
    for (let y = base; y <= base + 6; y += 1) set.add(y);
    existingYears.forEach((y) => set.delete(y));
    WQM_YEAR_OPTIONS.forEach((y) => set.delete(y));
    return [...set].sort((a, b) => a - b).map((y) => ({ value: y, label: String(y) }));
  }, [existingYears]);

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      onOk={handleCreate}
      okText="Create Monitoring Year"
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
              style={{ width: 200 }}
              onChange={(value) => { setYear(value); setError(''); }}
              options={yearOptions}
              placeholder="Select year"
            />
          </div>
        </div>
        <div>
          <Text strong>Waterbodies &amp; Stations to include</Text>
          <Tag color="blue" style={{ marginInlineStart: 8 }}>{targetKeys.length} selected</Tag>
          <div style={{ marginTop: 6 }}>
            <Transfer
              dataSource={transferData}
              targetKeys={targetKeys}
              onChange={(keys) => { setTargetKeys(keys); setError(''); }}
              render={(item) => `${item.title} · ${item.province}`}
              titles={['Available', 'Included']}
              listStyle={{ width: 310, height: 320 }}
              showSearch
              filterOption={(input, item) =>
                item.title.toLowerCase().includes(input.toLowerCase()) ||
                item.province.toLowerCase().includes(input.toLowerCase())
              }
            />
          </div>
        </div>
        {error && <Alert type="error" showIcon title={error} />}
      </Space>
    </Modal>
  );
};

export default NewMonitoringYearModal;
