import { useTheme } from '../context/themeStore';
import { IcoMoon, IcoSun } from './Icons';

/**
 * Light/dark switch for the auth screens (Login, Register, Forgot/Reset
 * Password).
 *
 * Every other surface in the app exposes a theme toggle; without one here a
 * visitor who lands directly on /admin has no way to change the theme, and the
 * auth pages were the only screens that could not be switched.
 */
const AuthThemeToggle = () => {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      className="login-theme-toggle"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {isDark ? <IcoSun size={16} /> : <IcoMoon size={16} />}
    </button>
  );
};

export default AuthThemeToggle;
