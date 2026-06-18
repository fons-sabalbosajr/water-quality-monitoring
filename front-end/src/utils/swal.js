import Swal from "sweetalert2";

/**
 * Themed SweetAlert2 wrappers used across the WQMS app.
 * Colors follow the app palette and adapt to the current light/dark theme
 * (read from the `data-theme` attribute set by ThemeContext).
 */

const BRAND = "#446ACB";
const SUCCESS = "#7CB675";
const DANGER = "#dc2626";

const isDark = () =>
  document.documentElement.getAttribute("data-theme") === "dark";

const themed = () =>
  isDark()
    ? { background: "#1e293b", color: "#e2e8f0" }
    : { background: "#ffffff", color: "#1f2937" };

const baseButtons = {
  confirmButtonColor: BRAND,
  cancelButtonColor: "#94a3b8",
  buttonsStyling: true,
};

/** Small non-blocking success/info toast (top-right). */
export const toast = (title, icon = "success") =>
  Swal.fire({
    toast: true,
    position: "top-end",
    icon,
    title,
    showConfirmButton: false,
    timer: 2200,
    timerProgressBar: true,
    ...themed(),
  });

/** Saved confirmation toast. */
export const toastSaved = (title = "Saved successfully") =>
  toast(title, "success");

/** Centered success modal. */
export const alertSuccess = (title, text = "") =>
  Swal.fire({
    icon: "success",
    title,
    text,
    confirmButtonText: "OK",
    ...baseButtons,
    confirmButtonColor: SUCCESS,
    ...themed(),
  });

/** Centered error modal. */
export const alertError = (title, text = "") =>
  Swal.fire({
    icon: "error",
    title,
    text,
    confirmButtonText: "OK",
    ...baseButtons,
    confirmButtonColor: DANGER,
    ...themed(),
  });

/** Centered info modal. */
export const alertInfo = (title, text = "") =>
  Swal.fire({
    icon: "info",
    title,
    text,
    confirmButtonText: "OK",
    ...baseButtons,
    ...themed(),
  });

/**
 * Confirmation dialog. Returns a boolean (true when confirmed).
 */
export const confirmAction = async ({
  title = "Are you sure?",
  text = "",
  icon = "warning",
  confirmButtonText = "Yes, continue",
  cancelButtonText = "Cancel",
  danger = false,
} = {}) => {
  const result = await Swal.fire({
    title,
    text,
    icon,
    showCancelButton: true,
    confirmButtonText,
    cancelButtonText,
    reverseButtons: true,
    focusCancel: true,
    ...baseButtons,
    confirmButtonColor: danger ? DANGER : BRAND,
    ...themed(),
  });
  return result.isConfirmed;
};

export default Swal;
