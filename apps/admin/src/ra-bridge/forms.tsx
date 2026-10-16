import { useState, type ReactNode } from 'react';
import {
  CreateBase,
  EditBase,
  Form,
  useDelete,
  useEditContext,
  useNotify,
  useRecordContext,
  useRedirect,
  useResourceContext,
  useSaveContext,
  useTranslate,
  type RaRecord,
  type RedirectionSideEffect,
  type TransformData,
} from 'ra-core';
import { useFormState } from 'react-hook-form';
import { AlertDialog, AlertDialogContent, Button, Card, Skeleton, type BreadcrumbItemData } from '@bridge-ds/react';
import { Save, Trash2 } from 'lucide-react';
import { Page } from './Page';
import { cx } from './cx';
import styles from './form.module.css';

interface RecordPageProps<R extends RaRecord> {
  title: (record: R) => ReactNode;
  subtitle?: (record: R) => ReactNode;
  breadcrumb?: (record: R | undefined) => BreadcrumbItemData[];
  actions?: (record: R) => ReactNode;
  media?: (record: R) => ReactNode;
  children: ReactNode;
}

export interface EditPageProps<R extends RaRecord> extends RecordPageProps<R> {
  redirect?: RedirectionSideEffect;
  transform?: TransformData;
  /** Wrap children in a ra-core Form with the save toolbar. Set false when the page lays out its own forms. */
  form?: boolean;
  /** Content beside the form on wide screens (related records, history). */
  aside?: ReactNode;
  /** Show the delete action in the toolbar. Default true. */
  deletable?: boolean;
}

/**
 * Edit screen on ra-core EditBase: loads the record, saves pessimistically (the toast confirms after
 * the server answers), and renders a Bridge page with a skeleton while loading.
 */
export function EditPage<R extends RaRecord>({ redirect = false, transform, ...props }: EditPageProps<R>) {
  return (
    <EditBase mutationMode="pessimistic" redirect={redirect} transform={transform}>
      <EditView<R> {...props} />
    </EditBase>
  );
}

function EditView<R extends RaRecord>({ title, subtitle, breadcrumb, actions, media, children, form = true, aside, deletable = true }: Omit<EditPageProps<R>, 'redirect' | 'transform'>) {
  const { record, isPending } = useEditContext<R>();
  if (isPending || !record) return <RecordSkeleton />;
  const body = form ? (
    <Form className={styles.form}>
      {children}
      <FormToolbar deletable={deletable} />
    </Form>
  ) : (
    children
  );
  return (
    <Page
      title={title(record)}
      subtitle={subtitle?.(record)}
      breadcrumb={breadcrumb?.(record)}
      actions={actions?.(record)}
      media={media?.(record)}
    >
      {aside ? (
        <div className={styles.withAside}>
          <div className={styles.main}>{body}</div>
          <aside className={styles.aside}>{aside}</aside>
        </div>
      ) : (
        body
      )}
    </Page>
  );
}

export function CreatePage({
  title,
  breadcrumb,
  children,
  redirect = 'edit',
  transform,
  defaultValues,
}: {
  title: ReactNode;
  breadcrumb?: BreadcrumbItemData[];
  children: ReactNode;
  redirect?: RedirectionSideEffect;
  transform?: TransformData;
  defaultValues?: Record<string, unknown>;
}) {
  return (
    <CreateBase redirect={redirect} transform={transform}>
      <Page title={title} breadcrumb={breadcrumb}>
        <Form className={styles.form} defaultValues={defaultValues}>
          {children}
          <FormToolbar deletable={false} />
        </Form>
      </Page>
    </CreateBase>
  );
}

/** Save and delete actions at the end of a form. Save stays disabled until something changed. */
export function FormToolbar({ deletable = true, extra, sticky = true }: { deletable?: boolean; extra?: ReactNode; sticky?: boolean }) {
  const translate = useTranslate();
  const { saving } = useSaveContext();
  const { isDirty } = useFormState();
  const record = useRecordContext();
  return (
    <div className={cx(styles.toolbar, sticky && styles.sticky)}>
      {deletable && record && <DeleteButton />}
      <div className={styles.toolbarEnd}>
        {extra}
        <Button type="submit" variant="primary" iconStart={Save} loading={saving} disabled={!isDirty || saving}>
          {translate('bridge.form.save', { _: 'Save changes' })}
        </Button>
      </div>
    </div>
  );
}

/** Deletes the current record after an AlertDialog that names the consequence. */
export function DeleteButton({ label, redirectTo = 'list' }: { label?: string; redirectTo?: 'list' | false }) {
  const translate = useTranslate();
  const record = useRecordContext();
  const resource = useResourceContext();
  const notify = useNotify();
  const redirect = useRedirect();
  const [open, setOpen] = useState(false);
  const [deleteOne, { isPending }] = useDelete();
  if (!record || !resource) return null;
  const name = translate(`resources.${resource}.forcedCaseName`, { smart_count: 1, _: translate(`resources.${resource}.name`, { smart_count: 1, _: 'record' }) });
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button variant="secondary" iconStart={Trash2} onClick={() => setOpen(true)}>
        {label ?? translate('bridge.form.delete', { _: 'Delete' })}
      </Button>
      <AlertDialogContent
        title={translate('bridge.form.delete_title', { name: name.toLowerCase(), _: 'Delete this %{name}?' })}
        description={translate('bridge.form.delete_description', { _: 'It disappears from lists and reports. This cannot be undone.' })}
        confirmLabel={translate('bridge.form.delete_confirm', { name: name.toLowerCase(), _: 'Delete %{name}' })}
        cancelLabel={translate('bridge.form.cancel', { _: 'Cancel' })}
        loading={isPending}
        closeOnConfirm={false}
        onConfirm={() =>
          deleteOne(
            resource,
            { id: record.id, previousData: record },
            {
              onSuccess: () => {
                setOpen(false);
                notify('ra.notification.deleted', { type: 'success', messageArgs: { smart_count: 1 } });
                if (redirectTo) redirect('list', resource);
              },
              onError: () => notify('bridge.form.delete_failed', { type: 'error' }),
            },
          )
        }
      />
    </AlertDialog>
  );
}

/** Generic confirmation for a consequential action (bulk reject, cancel order). */
export function ConfirmButton({
  children,
  title,
  description,
  confirmLabel,
  onConfirm,
  tone = 'danger',
  variant = 'secondary',
  size = 'sm',
  icon,
  loading,
  disabled,
}: {
  children: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  tone?: 'danger' | 'primary';
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  icon?: Parameters<typeof Button>[0]['iconStart'];
  loading?: boolean;
  disabled?: boolean;
}) {
  const translate = useTranslate();
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button variant={variant} size={size} iconStart={icon} loading={loading} disabled={disabled} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <AlertDialogContent
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        cancelLabel={translate('bridge.form.cancel', { _: 'Cancel' })}
        tone={tone}
        onConfirm={onConfirm}
      />
    </AlertDialog>
  );
}

/** Placeholder layout while a record loads. */
export function RecordSkeleton() {
  return (
    <div className={styles.skeleton} aria-busy="true">
      <Skeleton width="var(--size-60)" />
      <Skeleton width="var(--size-80)" height="var(--size-8)" />
      <Card>
        <div className={styles.skeletonBody}>
          <Skeleton lines={3} />
          <Skeleton variant="rect" height="var(--size-10)" />
          <Skeleton variant="rect" height="var(--size-10)" />
        </div>
      </Card>
    </div>
  );
}

/** A titled group of fields inside a form card. */
export function FormSection({ title, description, children, columns = 2 }: { title?: ReactNode; description?: ReactNode; children: ReactNode; columns?: 1 | 2 | 3 }) {
  return (
    <section className={styles.section}>
      {(title || description) && (
        <header className={styles.sectionHeader}>
          {title && <h2 className={styles.sectionTitle}>{title}</h2>}
          {description && <p className={styles.sectionDescription}>{description}</p>}
        </header>
      )}
      <div className={cx(styles.fields, styles[`cols${columns}`])}>{children}</div>
    </section>
  );
}
