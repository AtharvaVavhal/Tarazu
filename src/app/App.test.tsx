// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App placeholder', () => {
  it('renders without showing any financial value', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Tarazu' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/₹/);
  });
});
