/**
 * Opaque-Box DOM Driver for EchoPlayerDesktop E2E Tests
 * Interacts with renderer DOM purely via browser events and observable contracts.
 */

class DOMDriver {
  constructor(win) {
    this.win = win;
  }

  get webContents() {
    return this.win.webContents;
  }

  async evaluate(codeOrFn, ...args) {
    if (typeof codeOrFn === 'function') {
      const fnStr = codeOrFn.toString();
      const argsJson = JSON.stringify(args);
      return this.webContents.executeJavaScript(`(${fnStr})(...${argsJson})`);
    }
    return this.webContents.executeJavaScript(codeOrFn);
  }

  async query(selector) {
    return this.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) {
        return { exists: false, selector: sel };
      }
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const isVisible = Boolean(
        el.offsetWidth > 0 ||
        el.offsetHeight > 0 ||
        rect.width > 0 ||
        rect.height > 0 ||
        (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0')
      );
      const attrs = {};
      for (const attr of el.attributes) {
        attrs[attr.name] = attr.value;
      }
      return {
        exists: true,
        selector: sel,
        tagName: el.tagName.toLowerCase(),
        id: el.id,
        className: el.className,
        classList: Array.from(el.classList),
        textContent: (el.textContent || '').trim(),
        value: el.value !== undefined ? el.value : null,
        checked: Boolean(el.checked),
        disabled: Boolean(el.disabled),
        isVisible,
        offsetWidth: el.offsetWidth,
        offsetHeight: el.offsetHeight,
        clientWidth: el.clientWidth,
        clientHeight: el.clientHeight,
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        attributes: attrs,
        rect: {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          bottom: rect.bottom,
          right: rect.right
        }
      };
    }, selector);
  }

  async queryAll(selector) {
    return this.evaluate((sel) => {
      const elements = Array.from(document.querySelectorAll(sel));
      return elements.map((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const isVisible = Boolean(
          el.offsetWidth > 0 ||
          el.offsetHeight > 0 ||
          rect.width > 0 ||
          rect.height > 0 ||
          (style.display !== 'none' && style.visibility !== 'hidden')
        );
        const attrs = {};
        for (const attr of el.attributes) {
          attrs[attr.name] = attr.value;
        }
        return {
          exists: true,
          tagName: el.tagName.toLowerCase(),
          id: el.id,
          className: el.className,
          classList: Array.from(el.classList),
          textContent: (el.textContent || '').trim(),
          value: el.value !== undefined ? el.value : null,
          checked: Boolean(el.checked),
          isVisible,
          attributes: attrs
        };
      });
    }, selector);
  }

  async click(selector) {
    return this.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) {
        throw new Error(`DOMDriver.click: Element not found matching selector "${sel}"`);
      }
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      el.click();
      return true;
    }, selector);
  }

  async wheel(selector, { deltaY = 120, deltaX = 0 }) {
    return this.evaluate((sel, dy, dx) => {
      const el = document.querySelector(sel) || document.body;
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      const event = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        deltaY: dy,
        deltaX: dx,
        deltaMode: 0
      });
      el.dispatchEvent(event);
      return true;
    }, selector, deltaY, deltaX);
  }

  async drag(selector, { startX = 0, startY = 0, endX = 0, endY = 0, steps = 5 }) {
    return this.evaluate((sel, sX, sY, eX, eY, stepCount) => {
      const el = document.querySelector(sel);
      if (!el) {
        throw new Error(`DOMDriver.drag: Element not found matching "${sel}"`);
      }
      const rect = el.getBoundingClientRect();
      const originX = sX || (rect.left + rect.width / 2);
      const originY = sY || (rect.top + rect.height / 2);
      const targetX = eX || originX;
      const targetY = eY || originY;

      el.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: originX,
        clientY: originY,
        pointerId: 1
      }));

      for (let i = 1; i <= stepCount; i++) {
        const progress = i / stepCount;
        const curX = originX + (targetX - originX) * progress;
        const curY = originY + (targetY - originY) * progress;
        window.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true,
          cancelable: true,
          clientX: curX,
          clientY: curY,
          pointerId: 1
        }));
      }

      window.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        clientX: targetX,
        clientY: targetY,
        pointerId: 1
      }));
      return true;
    }, selector, startX, startY, endX, endY, steps);
  }

  async getComputedStyleProperty(selector, property) {
    return this.evaluate((sel, prop) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return window.getComputedStyle(el).getPropertyValue(prop);
    }, selector, property);
  }

  async waitFor(predicateFn, options = {}) {
    const timeout = options.timeout || 5000;
    const interval = options.interval || 50;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      let result;
      if (typeof predicateFn === 'string') {
        const sel = predicateFn;
        result = await this.evaluate((s) => Boolean(document.querySelector(s)), sel);
      } else {
        result = await this.evaluate(predicateFn);
      }
      if (result) return result;
      await new Promise(r => setTimeout(r, interval));
    }
    throw new Error(`DOMDriver.waitFor timed out after ${timeout}ms`);
  }

  async simulateAudioEvent(deckId, eventName, detail = {}) {
    return this.evaluate((id, evName, det) => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`Audio element #${id} not found`);
      if (det.currentTime !== undefined) el.currentTime = det.currentTime;
      if (det.duration !== undefined) {
        Object.defineProperty(el, 'duration', { value: det.duration, configurable: true, writable: true });
      }
      el.dispatchEvent(new Event(evName, { bubbles: true }));
      return true;
    }, deckId, eventName, detail);
  }

  async simulateTimeUpdate(deckId, currentTime, duration) {
    return this.simulateAudioEvent(deckId, 'timeupdate', { currentTime, duration });
  }

  async resizeWindow(width, height) {
    this.win.setSize(width, height);
    // Allow renderer to process media queries and resize listeners
    await new Promise(r => setTimeout(r, 100));
  }
}

module.exports = {
  DOMDriver
};
