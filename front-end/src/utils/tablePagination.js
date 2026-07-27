import { useCallback, useMemo, useState } from 'react';
import encryptedStorage from './encryptedStorage.js';

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 10;
const PREF_KEY = 'wqms_table_page_sizes';

/**
 * Shared antd Table pagination config.
 *
 * Every table in the app passed a literal `pagination={{ pageSize: 10, ... }}`.
 * In antd, supplying `pageSize` makes it a *controlled* prop: the object is
 * rebuilt with `pageSize: 10` on every render, so it overwrote whatever the
 * user picked in the size changer. The selector visibly moved to "50 / page"
 * while the table kept showing 10 rows. Holding the value in state and feeding
 * it back is what actually makes the control work.
 *
 * The chosen size is remembered per table id so it survives navigation.
 *
 * @param {string} id       stable key for this table, used for persistence
 * @param {number} initial  default page size when nothing is stored
 */
export const useTablePagination = (id, initial = DEFAULT_PAGE_SIZE) => {
  const [pageSize, setPageSize] = useState(() => {
    try {
      const stored = encryptedStorage.getItem(PREF_KEY) || {};
      const saved = Number(stored[id]);
      return PAGE_SIZE_OPTIONS.includes(saved) ? saved : initial;
    } catch {
      return initial;
    }
  });
  const [current, setCurrent] = useState(1);

  const handleChange = useCallback((page, size) => {
    setCurrent(page);
    if (size && size !== pageSize) {
      setPageSize(size);
      // Changing the page size while deep in the list can leave the user on a
      // page that no longer exists; antd clamps the page but the scroll offset
      // is confusing, so go back to the first page.
      setCurrent(1);
      try {
        const stored = encryptedStorage.getItem(PREF_KEY) || {};
        encryptedStorage.setItem(PREF_KEY, { ...stored, [id]: size });
      } catch {
        /* persistence is best-effort */
      }
    }
  }, [id, pageSize]);

  // Clamp the current page when the data set shrinks (e.g. after a filter or a
  // delete), otherwise the table renders an empty page with no way back.
  const onTotalChange = useCallback((total) => {
    const lastPage = Math.max(1, Math.ceil(total / pageSize));
    setCurrent((page) => (page > lastPage ? lastPage : page));
  }, [pageSize]);

  const pagination = useMemo(() => ({
    current,
    pageSize,
    showSizeChanger: true,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    size: 'small',
    showTotal: (total, range) => `${range[0]}–${range[1]} of ${total}`,
    // Hide the pager entirely when everything fits on one page.
    hideOnSinglePage: false,
    responsive: true,
    onChange: handleChange,
    onShowSizeChange: handleChange,
  }), [current, pageSize, handleChange]);

  return { pagination, pageSize, current, setCurrent, onTotalChange };
};

export default useTablePagination;
