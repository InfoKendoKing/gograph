(function (root) {
  "use strict";
  const names = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], {type: "region"}) : null;
  function flagPath(country) {
    const code = country.toUpperCase() === "UK" ? "gb" : country.toLowerCase();
    return `flags/${/^[a-z]{2}$/.test(code) ? code : "xx"}.svg`;
  }
  function label(country) {
    if (!country) return "All countries";
    if (country === "__unknown__" || country === "??" || country === "XX") return "Unknown country";
    let name;
    try { name = names?.of(country.toUpperCase() === "UK" ? "GB" : country.toUpperCase()); } catch { /* Unrecognised EGD code. */ }
    return name && name !== country ? `${country} · ${name}` : country;
  }
  function setup(select, button, list, current, box, clearButton) {
    let active = 0, typeahead = "", lastTyped = 0;
    function contents(country) {
      const span = document.createElement("span"), text = document.createElement("span"); span.className = "country-choice";
      if (country) {
        const flag = document.createElement("img"); flag.src = flagPath(country); flag.alt = ""; flag.width = 24; flag.height = 18;
        flag.addEventListener("error", () => { if (!flag.src.endsWith("/xx.svg")) flag.src = "flags/xx.svg"; });
        span.append(flag);
      } else {
        const globe = document.createElement("span"); globe.textContent = "◎"; globe.className = "country-globe"; globe.setAttribute("aria-hidden", "true"); span.append(globe);
      }
      text.textContent = label(country); span.append(text); return span;
    }
    function highlight() {
      for (const [index, option] of [...list.children].entries()) {
        option.classList.toggle("active", index === active);
        option.setAttribute("aria-selected", String(select.options[index].value === select.value));
      }
      if (!list.hidden && list.children[active]) {
        button.setAttribute("aria-activedescendant", list.children[active].id);
        list.children[active].scrollIntoView({block: "nearest"});
      }
    }
    function close() { list.hidden = true; button.setAttribute("aria-expanded", "false"); button.removeAttribute("aria-activedescendant"); }
    function open() { active = Math.max(0, select.selectedIndex); list.hidden = false; button.setAttribute("aria-expanded", "true"); highlight(); }
    function sync() { current.replaceChildren(contents(select.value)); clearButton.hidden = !select.value; highlight(); }
    function choose(index) {
      select.value = select.options[index].value; select.dispatchEvent(new Event("change")); close(); button.focus({preventScroll: true});
    }
    function refresh() {
      close(); list.replaceChildren();
      for (const [index, option] of [...select.options].entries()) {
        const item = document.createElement("li"); item.id = `country-option-${index}`; item.setAttribute("role", "option");
        item.append(contents(option.value));
        item.addEventListener("pointerdown", event => event.preventDefault());
        item.addEventListener("click", () => choose(index)); list.append(item);
      }
      active = Math.max(0, select.selectedIndex); sync(); button.disabled = false;
    }
    button.addEventListener("click", () => list.hidden ? open() : close());
    clearButton.addEventListener("click", () => choose(0));
    button.addEventListener("keydown", event => {
      if (event.key === "Escape") { close(); return; }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        if (list.hidden) open();
        else if (event.key === "ArrowDown") active = (active + 1) % list.children.length;
        else if (event.key === "ArrowUp") active = (active + list.children.length - 1) % list.children.length;
        if (event.key === "Home") active = 0;
        if (event.key === "End") active = list.children.length - 1;
        highlight();
      } else if ((event.key === "Enter" || event.key === " ") && !list.hidden) { event.preventDefault(); choose(active); }
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== " ") {
        event.preventDefault(); if (list.hidden) open();
        const now = Date.now(); typeahead = (now - lastTyped > 800 ? "" : typeahead) + event.key.toLowerCase(); lastTyped = now;
        const index = [...select.options].findIndex(option => label(option.value).toLowerCase().startsWith(typeahead)
          || label(option.value).toLowerCase().split(" · ").at(-1).startsWith(typeahead));
        if (index >= 0) { active = index; highlight(); }
      }
    });
    select.addEventListener("change", sync);
    document.addEventListener("pointerdown", event => { if (!box.contains(event.target)) close(); });
    box.addEventListener("focusout", event => { if (!box.contains(event.relatedTarget)) close(); });
    return {refresh, sync};
  }
  const api = {flagPath, label, setup}; root.EgdCountries = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
