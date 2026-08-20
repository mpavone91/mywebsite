import { el, esc, eur, monthKey, toast, sum, round2 } from '../utils.js';
import { state, categoriesOf, addCategory, updateCategory, deleteCategory } from '../store.js';
import { openSheet, confirmSheet, emptyState } from '../ui.js';

const PALETTE = [
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#ef4444', '#f97316',
  '#f59e0b', '#eab308', '#22c55e', '#10b981', '#14b8a6', '#06b6d4',
  '#0ea5e9', '#3b82f6', '#64748b', '#78716c',
];

const BUCKETS = [
  { value: 'needs', label: 'Necesidad', hint: 'Vivienda, comida, transporte… el 50 % de la regla' },
  { value: 'wants', label: 'Deseo', hint: 'Ocio, caprichos, suscripciones… el 30 %' },
  { value: 'savings', label: 'Ahorro', hint: 'Aportaciones a ahorro o inversión… el 20 %' },
];

/** Pantalla de gestión de categorías. */
export function renderCategories() {
  const screen = el(`
    <div class="screen">
      <div class="screen-head">
        <div>
          <h1>Categorías</h1>
          <p>Colores y reparto 50/30/20</p>
        </div>
      </div>
      <div class="stack" data-body></div>
    </div>
  `);

  const body = screen.querySelector('[data-body]');

  function paint() {
    body.replaceChildren(
      groupSection('Gastos', 'expense'),
      groupSection('Ingresos', 'income'),
      el('<p class="tiny muted center" style="margin:4px 16px 0">Las categorías con movimientos no se borran: se archivan, para no dejar huérfano el histórico.</p>'),
    );
  }

  function groupSection(title, type) {
    // Incluimos las archivadas (atenuadas) para poder reactivarlas desde aquí
    const cats = categoriesOf(type, { includeArchived: true });
    const month = monthKey();

    const section = el(`
      <div>
        <div class="section-title">${title}</div>
        <div class="card card-flush">
          <div class="list" data-list>
            ${cats.length ? '' : emptyState('No hay categorías todavía.')}
          </div>
        </div>
        <button class="btn btn-block" data-new style="margin-top:10px">+ Nueva categoría de ${type === 'expense' ? 'gasto' : 'ingreso'}</button>
      </div>
    `);

    const list = section.querySelector('[data-list]');
    for (const cat of cats) {
      const rows = type === 'expense'
        ? state.expenses.filter((e) => e.category_id === cat.id && e.date.slice(0, 7) === month)
        : state.incomes.filter((i) => i.category_id === cat.id && i.date.slice(0, 7) === month);
      const total = round2(sum(rows, (r) => r.amount));

      const item = el(`
        <button class="list-item" type="button" style="${cat.is_archived ? 'opacity:.5' : ''}">
          <span class="swatch" style="background:${esc(cat.color)}"></span>
          <span class="grow" style="min-width:0">
            <span class="truncate" style="display:block;font-weight:600">${esc(cat.name)}</span>
            <span class="tiny muted">${cat.is_archived ? 'Archivada' : (type === 'expense' ? esc(bucketLabel(cat.bucket)) : 'Ingreso')}</span>
          </span>
          <span style="text-align:right">
            <span class="num small">${total > 0 ? eur(total) : '—'}</span>
            <span class="tiny muted" style="display:block">este mes</span>
          </span>
        </button>
      `);
      item.addEventListener('click', () => openCategorySheet({ category: cat, onSaved: paint }));
      list.appendChild(item);
    }

    section.querySelector('[data-new]').addEventListener('click', () => {
      openCategorySheet({ type, onSaved: paint });
    });

    return section;
  }

  paint();
  return screen;
}

function bucketLabel(bucket) {
  return BUCKETS.find((b) => b.value === bucket)?.label || 'Deseo';
}

/** Alta/edición de una categoría. */
export function openCategorySheet({ category = null, type = 'expense', onSaved } = {}) {
  const editing = Boolean(category);
  const kind = category?.type || type;

  return openSheet(editing ? 'Editar categoría' : 'Nueva categoría', (close) => {
    let color = category?.color || PALETTE[Math.floor(Math.random() * PALETTE.length)];
    let bucket = category?.bucket || 'wants';

    const body = el(`
      <div class="stack">
        <label class="field">
          <span>Nombre</span>
          <input type="text" data-name maxlength="40" data-autofocus
                 placeholder="Ej. Alimentación" value="${esc(category?.name || '')}">
        </label>

        <div>
          <div class="section-title" style="margin-top:6px">Color</div>
          <div class="chips" data-colors>
            ${PALETTE.map((c) => `
              <button type="button" class="swatch" data-color="${c}"
                      style="background:${c};width:38px;height:38px;border-width:${c === color ? '3px' : '1px'};border-color:${c === color ? 'var(--text)' : 'var(--border)'}"
                      aria-label="Color ${c}"></button>`).join('')}
          </div>
        </div>

        ${kind === 'expense' ? `
          <div>
            <div class="section-title">Cuenta como</div>
            <div class="stack" data-buckets>
              ${BUCKETS.map((b) => `
                <button type="button" class="card row" data-bucket="${b.value}"
                        style="padding:12px 14px;text-align:left;border-color:${b.value === bucket ? 'var(--accent)' : 'var(--border)'}">
                  <span class="grow">
                    <strong style="font-size:15px">${b.label}</strong>
                    <span class="tiny muted" style="display:block">${b.hint}</span>
                  </span>
                  <span data-check style="color:var(--accent);font-weight:700">${b.value === bucket ? '✓' : ''}</span>
                </button>`).join('')}
            </div>
          </div>` : ''}

        <button class="btn btn-primary btn-block btn-lg" data-save>${editing ? 'Guardar cambios' : 'Crear categoría'}</button>
        ${editing ? `<button class="btn btn-danger btn-block" data-delete>${category.is_archived ? 'Reactivar' : 'Eliminar'} categoría</button>` : ''}
      </div>
    `);

    body.querySelectorAll('[data-color]').forEach((btn) => {
      btn.addEventListener('click', () => {
        color = btn.dataset.color;
        body.querySelectorAll('[data-color]').forEach((b) => {
          const on = b.dataset.color === color;
          b.style.borderWidth = on ? '3px' : '1px';
          b.style.borderColor = on ? 'var(--text)' : 'var(--border)';
        });
      });
    });

    body.querySelectorAll('[data-bucket]').forEach((btn) => {
      btn.addEventListener('click', () => {
        bucket = btn.dataset.bucket;
        body.querySelectorAll('[data-bucket]').forEach((b) => {
          const on = b.dataset.bucket === bucket;
          b.style.borderColor = on ? 'var(--accent)' : 'var(--border)';
          b.querySelector('[data-check]').textContent = on ? '✓' : '';
        });
      });
    });

    const saveBtn = body.querySelector('[data-save]');
    saveBtn.addEventListener('click', async () => {
      const name = body.querySelector('[data-name]').value.trim();
      if (!name) { toast('Ponle un nombre a la categoría', 'err'); return; }

      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="spinner"></span>';
      try {
        if (editing) await updateCategory(category.id, { name, color, bucket, is_archived: false });
        else await addCategory({ name, type: kind, color, bucket });
        close(true);
        toast(editing ? 'Categoría actualizada' : 'Categoría creada');
        onSaved?.();
      } catch (err) {
        const msg = err.code === '23505' ? 'Ya tienes una categoría con ese nombre' : (err.message || 'No se pudo guardar');
        toast(msg, 'err');
        saveBtn.disabled = false;
        saveBtn.textContent = editing ? 'Guardar cambios' : 'Crear categoría';
      }
    });

    body.querySelector('[data-delete]')?.addEventListener('click', async () => {
      if (category.is_archived) {
        await updateCategory(category.id, { is_archived: false });
        close(true);
        toast('Categoría reactivada');
        onSaved?.();
        return;
      }
      const ok = await confirmSheet(
        'Eliminar categoría',
        `Si "${category.name}" tiene movimientos se archivará en vez de borrarse, para no perder el histórico.`,
      );
      if (!ok) return;
      try {
        await deleteCategory(category.id);
        close(true);
        toast('Categoría eliminada');
        onSaved?.();
      } catch (err) {
        toast(err.message || 'No se pudo eliminar', 'err');
      }
    });

    return body;
  });
}
