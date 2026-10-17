import './style.css';

export const metadata = { title: 'Static export reproduction' };

export default function Layout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
