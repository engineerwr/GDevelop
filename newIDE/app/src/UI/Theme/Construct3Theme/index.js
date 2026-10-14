// @flow
import { createGdevelopTheme } from '../CreateTheme';
import styles from './Construct3ThemeVariables.json';
import './Construct3ThemeVariables.css';
import './Construct3Theme.css';

export default createGdevelopTheme({
  styles,
  rootClassNameIdentifier: 'Construct3Theme',
  paletteType: 'dark',
});
