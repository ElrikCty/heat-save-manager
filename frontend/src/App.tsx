import {useEffect, useMemo, useRef, useState} from 'react';
import {AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, CircleX, Download, Edit3, FileText, Folder, FolderOpen, HardDrive, Info, Plus, RefreshCw, Save, Trash2, Upload, Zap} from 'lucide-react';
import './App.css';
import {EventsOn, Quit} from '../wailsjs/runtime/runtime';
import {
    CheckForUpdates,
    CreateMarkerFile,
    DeleteProfile,
    GetAppVersion,
    GetLanguage,
    EnsureProfilesFolder,
    ExportProfileBundle,
    GetActiveProfile,
    GetPaths,
    ImportProfileBundle,
    ListProfiles,
    PickImportBundlePath,
    PickSaveGamePath,
    PrepareFreshProfile,
    PrepareFreshProfileWithoutSave,
    OpenExternalURL,
    RenameProfile,
    SaveCurrentProfile,
    SetLanguage,
    SetSaveGamePath,
    StartInAppUpdate,
    SwitchProfile,
    RunHealthCheck,
} from '../wailsjs/go/main/App';
import {createTranslator, type Locale, normalizeLocale, type Translator} from './i18n';

type Profile = {
    name: string;
};

type HealthItem = {
    name: string;
    ok: boolean;
    severity: string;
    message: string;
};

type HealthReport = {
    ready: boolean;
    checkedAt: string;
    items: HealthItem[];
};

type UpdateInfo = {
    currentVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
    releaseUrl: string;
    downloadUrl: string;
    downloadAsset: string;
    downloadKind: string;
    inAppEligible: boolean;
    inAppReason: string;
    publishedAt: string;
    notes: string;
};

type UpdateInstallResult = {
    started: boolean;
    message: string;
    fallbackUrl: string;
};

type UpdateProgressEvent = {
    stage?: string;
    message?: string;
    downloadedBytes?: number;
    totalBytes?: number;
    percent?: number;
};

type ErrorFeedback = {
    message: string;
    hint: string;
};

type DiagnosticsQuickAction = 'profiles' | 'marker' | 'firstSave';

const NEW_PROFILE_OPTION = '__new__';

function normalizeError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

function toErrorFeedback(error: unknown, fallback: string, t: Translator): ErrorFeedback {
    const detail = normalizeError(error);
    const lowered = detail.toLowerCase();

    if (lowered.includes('cannot delete active profile')) {
        return {
            message: t('feedback.cannotDelete.message'),
            hint: t('feedback.cannotDelete.hint'),
        };
    }

    if (lowered.includes('root savegame folder is missing') || lowered.includes('root wraps folder is missing')) {
        return {
            message: t('feedback.rootMissing.message'),
            hint: t('feedback.rootMissing.hint'),
        };
    }

    if (lowered.includes('savegame path') || lowered.includes('path must point to the savegame folder')) {
        return {
            message: t('feedback.pathInvalid.message'),
            hint: t('feedback.pathInvalid.hint'),
        };
    }

    if (lowered.includes('invalid characters') || lowered.includes('profile name is required')) {
        return {
            message: t('feedback.profileNameInvalid.message'),
            hint: t('feedback.profileNameInvalid.hint'),
        };
    }

    if (lowered.includes('already exists')) {
        return {
            message: t('feedback.profileExists.message'),
            hint: t('feedback.profileExists.hint'),
        };
    }

    if (lowered.includes('profile not found')) {
        return {
            message: t('feedback.profileNotFound.message'),
            hint: t('feedback.profileNotFound.hint'),
        };
    }

    if (lowered.includes('active profile marker is required to preserve current progress')) {
        return {
            message: t('feedback.saveFirstNeedsActive.message'),
            hint: t('feedback.saveFirstNeedsActive.hint'),
        };
    }

    if (lowered.includes('new profile name must differ from active profile when preserving current progress')) {
        return {
            message: t('feedback.freshNameConflict.message'),
            hint: t('feedback.freshNameConflict.hint'),
        };
    }

    if (lowered.includes('access is denied') || lowered.includes('being used by another process')) {
        return {
            message: t('feedback.lockedFiles.message'),
            hint: t('feedback.lockedFiles.hint'),
        };
    }

    if (lowered.includes('requires elevation') || lowered.includes('requested operation requires elevation')) {
        return {
            message: t('feedback.elevation.message'),
            hint: t('feedback.elevation.hint'),
        };
    }

    if (lowered.includes('direct update requires a windows installer asset') || lowered.includes('update download url is required')) {
        return {
            message: t('feedback.inAppUnavailable.message'),
            hint: t('feedback.inAppUnavailable.hint'),
        };
    }

    if (lowered.includes('bundle contains invalid file path')) {
        return {
            message: t('feedback.bundleUnsafe.message'),
            hint: t('feedback.bundleUnsafe.hint'),
        };
    }

    if (lowered.includes('invalid profile layout')) {
        return {
            message: t('feedback.bundleLayout.message'),
            hint: t('feedback.bundleLayout.hint'),
        };
    }

    return {
        message: `${fallback}: ${detail}`,
        hint: '',
    };
}

const healthMessageKeyByText: Record<string, string> = {
    'SaveGame path is not configured.': 'health.message.savegameNotConfigured',
    'Directory is missing.': 'health.message.directoryMissing',
    'Failed to inspect directory.': 'health.message.directoryInspectFailed',
    'Path exists but is not a directory.': 'health.message.directoryWrongType',
    'Directory is available.': 'health.message.directoryAvailable',
    'active_profile.txt is missing.': 'health.message.markerMissing',
    'Failed to read active_profile.txt.': 'health.message.markerReadFailed',
    'active_profile.txt is empty.': 'health.message.markerEmpty',
    'active_profile.txt is valid.': 'health.message.markerValid',
    'Active profile folder exists.': 'health.message.activeProfileFolderExists',
    'Active profile marker does not match a folder in Profiles.': 'health.message.activeProfileFolderMissing',
};

function localizeHealthItemName(name: string, t: Translator): string {
    return t(`health.name.${name}`);
}

function localizeHealthMessage(message: string, t: Translator): string {
    const key = healthMessageKeyByText[message.trim()];
    if (!key) {
        return message;
    }

    return t(key);
}

const updaterMessageKeyByText: Record<string, string> = {
    'Validating update package...': 'update.validating',
    'Update validation failed.': 'update.failed',
    'Downloading installer update...': 'status.updateInstallerDownload',
    'Failed to download installer update.': 'update.failed',
    'Installer downloaded. Launching installer...': 'update.launchingInstaller',
    'Launching installer... approve the Windows prompt if asked.': 'update.launchingInstaller',
    'Failed to launch installer.': 'update.failed',
    'Installer launched. Closing app to finish update...': 'status.installerLaunched',
};

function localizeUpdaterMessage(message: string, t: Translator): string {
    const key = updaterMessageKeyByText[message.trim()];
    if (!key) {
        return message;
    }

    return t(key);
}

function maskWindowsUserPath(path: string): string {
    if (!path) {
        return path;
    }

    return path.replace(/([\\/]Users[\\/])[^\\/]+/i, '$1<user>');
}

function buildExportBundlePath(saveGamePath: string, profileName: string): string {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 13);
    const safe = profileName.replace(/[^a-zA-Z0-9-_]/g, '_');
    return `${saveGamePath}\\Exports\\${safe}-${stamp}.zip`;
}

function getDiagnosticItemIcon(name: string) {
    switch (name) {
    case 'savegame_path':
        return <HardDrive size={14} strokeWidth={2} />;
    case 'marker_file':
        return <FileText size={14} strokeWidth={2} />;
    case 'active_profile_folder':
    case 'profiles_path':
        return <FolderOpen size={14} strokeWidth={2} />;
    case 'root_savegame_folder':
    case 'root_wraps_folder':
        return <Folder size={14} strokeWidth={2} />;
    default:
        return <Folder size={14} strokeWidth={2} />;
    }
}

function formatBytes(size: number): string {
    if (!Number.isFinite(size) || size < 0) {
        return '0 B';
    }

    if (size < 1024) {
        return `${Math.round(size)} B`;
    }

    if (size < 1024 * 1024) {
        return `${(size / 1024).toFixed(1)} KB`;
    }

    if (size < 1024 * 1024 * 1024) {
        return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }

    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatEta(totalSeconds: number): string {
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
        return 'ETA <1s';
    }

    const rounded = Math.max(1, Math.round(totalSeconds));
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const seconds = rounded % 60;

    if (hours > 0) {
        return `ETA ${hours}h ${minutes}m`;
    }

    if (minutes > 0) {
        return `ETA ${minutes}m ${seconds}s`;
    }

    return `ETA ${seconds}s`;
}

function formatRate(bytesPerSecond: number): string {
    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
        return '';
    }

    return `${formatBytes(bytesPerSecond)}/s`;
}

const updateProgressEventName = 'updater:progress';
const slowNetworkThresholdBps = 256 * 1024;
const slowNetworkDelayMs = 5000;
const toastVisibilityMs = 6400;

function App() {
    type ToastKind = 'success' | 'info' | 'error';
    const [language, setLanguage] = useState<Locale>('en');
    const [isLanguageReady, setIsLanguageReady] = useState(false);
    const [saveGamePath, setSaveGamePath] = useState('');
    const [saveGamePathInput, setSaveGamePathInput] = useState('');
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [activeProfile, setActiveProfile] = useState('');
    const [freshProfileName, setFreshProfileName] = useState('');
    const [freshPrepareMode, setFreshPrepareMode] = useState<'saveFirst' | 'skipSave' | null>(null);
    const [saveDestinationMode, setSaveDestinationMode] = useState<'active' | 'custom'>('active');
    const [saveDestinationProfile, setSaveDestinationProfile] = useState('');
    const [saveDestinationNewName, setSaveDestinationNewName] = useState('');
    const [exportProfileName, setExportProfileName] = useState('');
    const [importTargetProfile, setImportTargetProfile] = useState('');
    const [importTargetNewName, setImportTargetNewName] = useState('');
    const [importBundlePath, setImportBundlePath] = useState('');
    const [status, setStatus] = useState(() => createTranslator('en')('status.loadingProfiles'));
    const [recoveryHint, setRecoveryHint] = useState('');
    const [healthReport, setHealthReport] = useState<HealthReport | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [renameTarget, setRenameTarget] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
    const [markerDialogProfile, setMarkerDialogProfile] = useState('');
    const [diagnosticsModal, setDiagnosticsModal] = useState<DiagnosticsQuickAction | null>(null);
    const [isExportModalOpen, setIsExportModalOpen] = useState(false);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [firstSaveProfileName, setFirstSaveProfileName] = useState('');
    const [isFreshConfirmOpen, setIsFreshConfirmOpen] = useState(false);
    const [isFreshNameModalOpen, setIsFreshNameModalOpen] = useState(false);
    const [isBundleExpanded, setIsBundleExpanded] = useState(false);
    const [selectedProfileName, setSelectedProfileName] = useState('');
    const [toastMessage, setToastMessage] = useState('');
    const [toastKind, setToastKind] = useState<ToastKind>('success');
    const [toastSequence, setToastSequence] = useState(0);
    const [appVersion, setAppVersion] = useState('');
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [isUpdateDismissed, setIsUpdateDismissed] = useState(false);
    const [isUpdateInstalling, setIsUpdateInstalling] = useState(false);
    const [updateInstallLabel, setUpdateInstallLabel] = useState(() => createTranslator('en')('common.installing'));
    const [updateInstallPercent, setUpdateInstallPercent] = useState<number | null>(null);
    const [updateInstallEta, setUpdateInstallEta] = useState<string | null>(null);
    const [updateInstallSpeed, setUpdateInstallSpeed] = useState<string | null>(null);
    const [isSlowNetworkHintVisible, setIsSlowNetworkHintVisible] = useState(false);
    const [isSavePathSetupOpen, setIsSavePathSetupOpen] = useState(false);
    const [switchConfirmProfile, setSwitchConfirmProfile] = useState<string | null>(null);
    const saveActionsRef = useRef<HTMLDivElement | null>(null);
    const importNewProfileRef = useRef<HTMLInputElement | null>(null);
    const toastTimerRef = useRef<number | null>(null);
    const lastStatusToastRef = useRef('');
    const lastRecoveryToastRef = useRef('');
    const updateSpeedTrackerRef = useRef({
        lastAtMs: 0,
        lastBytes: 0,
        smoothedBps: 0,
        slowSinceMs: 0,
    });

    const t = useMemo(() => createTranslator(language), [language]);

    const isModalOpen = isSavePathSetupOpen || switchConfirmProfile !== null || renameTarget !== null || deleteTarget !== null || diagnosticsModal !== null || isExportModalOpen || isImportModalOpen || isFreshConfirmOpen || isFreshNameModalOpen;

    const canApplyPath = saveGamePathInput.trim() !== '';
    const canExportBundle = exportProfileName.trim() !== '';
    const resolvedImportTarget = importTargetProfile === NEW_PROFILE_OPTION ? importTargetNewName.trim() : importTargetProfile.trim();
    const canImportBundle = resolvedImportTarget !== '' && importBundlePath.trim() !== '';
    const hasSelectedProfile = selectedProfileName.trim() !== '';
    const selectedIsActive = hasSelectedProfile && activeProfile.trim() !== '' && selectedProfileName.trim().toLowerCase() === activeProfile.trim().toLowerCase();
    const deletableProfiles = profiles.filter((profile) => profile.name.trim().toLowerCase() !== activeProfile.trim().toLowerCase());
    const hasDeletableProfiles = deletableProfiles.length > 0;
    const saveGamePathHealthItem = healthReport?.items.find((item) => item.name === 'savegame_path') ?? null;
    const needsSaveGamePathFix = saveGamePathHealthItem ? !saveGamePathHealthItem.ok : false;
    const markerHealthItem = healthReport?.items.find((item) => item.name === 'marker_file') ?? null;
    const needsProfilesFolderFix = healthReport?.items.some((item) => item.name === 'profiles_path' && !item.ok) ?? false;
    const needsMarkerFileFix = markerHealthItem ? !markerHealthItem.ok : false;
    const needsCombinedSetupFix = needsProfilesFolderFix && needsMarkerFileFix;
    const hasQuickActions = needsSaveGamePathFix || needsProfilesFolderFix || needsMarkerFileFix;
    const hasDiagnosticErrors = healthReport?.items.some((item) => item.severity === 'error') ?? false;
    const hasDiagnosticWarnings = healthReport?.items.some((item) => item.severity === 'warn') ?? false;
    const diagnosticsStatusLabel = isLoading
        ? t('diagnostics.status.working')
        : !healthReport
            ? t('diagnostics.status.notRunYet')
            : hasDiagnosticErrors
                ? t('diagnostics.status.needsAttention')
                : hasDiagnosticWarnings
                    ? t('diagnostics.status.readyWithWarnings')
                    : t('diagnostics.status.ready');
    const diagnosticsStatusClass = isLoading
        ? 'diag-pending'
        : !healthReport
            ? 'diag-pending'
            : hasDiagnosticErrors
                ? 'diag-attention'
                : hasDiagnosticWarnings
                    ? 'diag-warning'
                    : 'diag-ready';
    const hasActiveDestination = activeProfile.trim() !== '' && !needsMarkerFileFix;
    const selectedCustomDestination = saveDestinationProfile === NEW_PROFILE_OPTION ? saveDestinationNewName.trim() : saveDestinationProfile.trim();
    const resolvedSaveDestination = saveDestinationMode === 'active' ? activeProfile.trim() : selectedCustomDestination;
    const canSaveCurrent = resolvedSaveDestination !== '';
    const isInAppUpdateEligible = updateInfo?.inAppEligible ?? false;
    const updatePrimaryLabel = isInAppUpdateEligible ? t('update.installButton') : t('update.updateNowButton');

    function showToast(message: string, kind: ToastKind = 'success') {
        setToastKind(kind);
        setToastMessage(message);
        setToastSequence((current) => current + 1);
    }

    function inferStatusToastKind(message: string): ToastKind {
        const lower = message.trim().toLowerCase();

        const errorPrefixes = ['choose ', 'enter ', 'select ', 'browse and choose ', 'no active profile', 'elige ', 'ingresa ', 'selecciona ', 'busca y elige ', 'no hay marker'];
        if (errorPrefixes.some((prefix) => lower.startsWith(prefix))) {
            return 'error';
        }

        const errorFragments = [
            'failed',
            'cannot',
            'error',
            'missing',
            'invalid',
            'must point to',
            'must differ',
            'requires',
            'unavailable',
            'not found',
            'no longer exists',
            'locked',
            'unsafe',
            'malformed',
            'did not',
            'denied',
            'cancelled',
            'canceled',
            'cannot execute',
            'fall',
            'falla',
            'no se puede',
            'no se pudo',
            'falta',
            'inval',
            'no existe',
            'bloquead',
            'cancelad',
        ];
        if (errorFragments.some((fragment) => lower.includes(fragment))) {
            return 'error';
        }

        const infoPrefixes = [
            'opening ',
            'running ',
            'refreshing ',
            'downloading ',
            'applying ',
            'creating ',
            'completing ',
            'setting ',
            'switching ',
            'saving ',
            'exporting ',
            'importing ',
            'renaming ',
            'deleting ',
            'validating ',
            'launching ',
            'working ',
            'abriendo ',
            'ejecutando ',
            'actualizando ',
            'descargando ',
            'aplicando ',
            'creando ',
            'completando ',
            'definiendo ',
            'cambiando ',
            'guardando ',
            'exportando ',
            'importando ',
            'renombrando ',
            'eliminando ',
            'validando ',
        ];
        if (
            lower.endsWith('...')
            || infoPrefixes.some((prefix) => lower.startsWith(prefix))
            || lower.includes('closing app')
            || lower.includes('confirm path')
            || lower.includes('cerrando aplicacion')
            || lower.includes('confirmar ruta')
        ) {
            return 'info';
        }

        return 'success';
    }

    function getLanguageLabel(locale: Locale, translate: Translator): string {
        return translate(`language.name.${locale}`);
    }

    async function onChangeLanguage(rawLanguage: string) {
        const nextLanguage = normalizeLocale(rawLanguage);
        if (nextLanguage === language) {
            return;
        }

        const previousLanguage = language;
        const nextTranslator = createTranslator(nextLanguage);
        setLanguage(nextLanguage);

        try {
            await SetLanguage(nextLanguage);
            setStatus(nextTranslator('language.updated', {language: getLanguageLabel(nextLanguage, nextTranslator)}));
            setRecoveryHint('');
        } catch {
            setLanguage(previousLanguage);
            setStatus(t('language.updateFailed'));
        }
    }

    async function loadLanguagePreference() {
        try {
            const savedLanguage = await GetLanguage();
            setLanguage(normalizeLocale(savedLanguage));
        } catch {
            setLanguage('en');
        } finally {
            setIsLanguageReady(true);
        }
    }

    async function loadData(withRefreshToast = false) {
        try {
            setIsLoading(true);
            const hadActiveBeforeLoad = activeProfile.trim() !== '';
            if (withRefreshToast) {
                showToast(t('update.refreshingData'), 'info');
            }
            const [paths, profileItems, health] = await Promise.all([GetPaths(), ListProfiles(), RunHealthCheck()]);
            setSaveGamePath(paths.saveGamePath);
            setSaveGamePathInput(paths.saveGamePath);
            setProfiles(profileItems);
            setMarkerDialogProfile((current) => {
                if (current && profileItems.some((profile) => profile.name === current)) {
                    return current;
                }

                return profileItems[0]?.name ?? '';
            });
            setHealthReport(health);

            const requiresSavePathSetup = health.items.some((item) => item.name === 'savegame_path' && !item.ok);
            setIsSavePathSetupOpen(requiresSavePathSetup);

            let resolvedActive = '';
            try {
                const active = await GetActiveProfile();
                resolvedActive = active;
                setActiveProfile(active);
            } catch {
                setActiveProfile('');
            }

            setSelectedProfileName(() => {
                if (resolvedActive && profileItems.some((profile) => profile.name === resolvedActive)) {
                    return resolvedActive;
                }

                return '';
            });

            setSaveDestinationProfile((current) => {
                if (current === NEW_PROFILE_OPTION) {
                    return NEW_PROFILE_OPTION;
                }

                if (current && profileItems.some((profile) => profile.name === current)) {
                    return current;
                }

                return profileItems[0]?.name ?? NEW_PROFILE_OPTION;
            });

            setSaveDestinationMode((current) => {
                if (current === 'active' && !resolvedActive) {
                    return 'custom';
                }

                if (current === 'custom' && resolvedActive && !hadActiveBeforeLoad) {
                    return 'active';
                }

                return current;
            });

            setExportProfileName((current) => {
                if (resolvedActive && profileItems.some((profile) => profile.name === resolvedActive)) {
                    return resolvedActive;
                }

                if (current && profileItems.some((profile) => profile.name === current)) {
                    return current;
                }

                return profileItems[0]?.name ?? '';
            });

            setImportTargetProfile((current) => {
                if (current === NEW_PROFILE_OPTION) {
                    return NEW_PROFILE_OPTION;
                }

                if (resolvedActive && profileItems.some((profile) => profile.name === resolvedActive)) {
                    return resolvedActive;
                }

                if (current && profileItems.some((profile) => profile.name === current)) {
                    return current;
                }

                return profileItems[0]?.name ?? NEW_PROFILE_OPTION;
            });

            if (requiresSavePathSetup) {
                setStatus(t('status.setupRequired'));
                setRecoveryHint(t('status.setupRequiredHint'));
            } else {
                setStatus(t('common.ready'));
                setRecoveryHint('');
            }
            if (withRefreshToast) {
                showToast(t('update.dataRefreshed'));
            }
        } catch (error) {
            const feedback = toErrorFeedback(error, t('error.loadProfiles'), t);
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    async function checkForUpdates() {
        let resolvedVersion = '';

        try {
            resolvedVersion = await GetAppVersion();
            setAppVersion(resolvedVersion);
        } catch {
            // Keep fallback version label if lookup fails.
        }

        try {
            const rawInfo = await CheckForUpdates() as Partial<UpdateInfo>;
            const info: UpdateInfo = {
                currentVersion: rawInfo.currentVersion || resolvedVersion || '',
                latestVersion: rawInfo.latestVersion || resolvedVersion || '',
                updateAvailable: Boolean(rawInfo.updateAvailable),
                releaseUrl: (rawInfo.releaseUrl || '').trim(),
                downloadUrl: (rawInfo.downloadUrl || '').trim(),
                downloadAsset: (rawInfo.downloadAsset || '').trim(),
                downloadKind: (rawInfo.downloadKind || '').trim(),
                inAppEligible: Boolean(rawInfo.inAppEligible),
                inAppReason: (rawInfo.inAppReason || '').trim(),
                publishedAt: (rawInfo.publishedAt || '').trim(),
                notes: rawInfo.notes || '',
            };

            setUpdateInfo(info);
            setIsUpdateDismissed(false);
            if (!resolvedVersion && info.currentVersion) {
                setAppVersion(info.currentVersion);
            }
            if (info.updateAvailable) {
                showToast(t('update.availableToast', {version: info.latestVersion}), 'info');
            }
        } catch {
            // Ignore update-check failures to avoid noisy startup UX.
        }
    }

    async function onOpenUpdateLink(url: string, label: string) {
        const trimmed = url.trim();
        if (!trimmed) {
            return;
        }

        try {
            await OpenExternalURL(trimmed);
            setStatus(t('update.openingLink', {label}));
        } catch (error) {
            const feedback = toErrorFeedback(error, t('error.openUpdateLink', {label}), t);
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        }
    }

    function getInAppUpdateUnavailableMessage() {
        const reason = (updateInfo?.inAppReason || '').trim();
        if (reason) {
            if (reason.toLowerCase().includes('windows installer asset')) {
                return t('update.inAppUnavailableDefault');
            }

            return reason;
        }

        return t('update.inAppUnavailableDefault');
    }

    function notifyInAppUpdateUnavailable(customMessage?: string) {
        const message = (customMessage || getInAppUpdateUnavailableMessage()).trim() || t('update.inAppUnavailableDefault');
        lastStatusToastRef.current = message;
        setStatus(message);
        setRecoveryHint(t('update.manualInstallHint'));
        showToast(message, 'error');
    }

    async function onInstallUpdate() {
        const downloadUrl = (updateInfo?.downloadUrl || '').trim();
        const releaseUrl = (updateInfo?.releaseUrl || '').trim();

        if (!updateInfo?.inAppEligible) {
            notifyInAppUpdateUnavailable();
            return;
        }

        if (!downloadUrl) {
            notifyInAppUpdateUnavailable(t('update.missingInstallerURL'));
            return;
        }

        try {
            setIsLoading(true);
            setIsUpdateInstalling(true);
            setUpdateInstallLabel(t('update.downloading'));
            setUpdateInstallPercent(0);
            setUpdateInstallEta(null);
            setUpdateInstallSpeed(null);
            setIsSlowNetworkHintVisible(false);
            updateSpeedTrackerRef.current = {lastAtMs: 0, lastBytes: 0, smoothedBps: 0, slowSinceMs: 0};
            setStatus(t('status.updateInstallerDownload'));
            setRecoveryHint('');

            const result = await StartInAppUpdate(downloadUrl, releaseUrl) as UpdateInstallResult;
            const localizedResultMessage = localizeUpdaterMessage((result.message || '').trim(), t);
            const message = localizedResultMessage || t('status.installerLaunched');

            if (!result.started) {
                const fallbackMessage = localizedResultMessage || t('status.updateInstallerNotStarted');
                setStatus(fallbackMessage);
                setRecoveryHint(t('status.updateInstallerRetryHint'));
                setUpdateInstallLabel(t('common.installing'));
                setUpdateInstallPercent(null);
                setUpdateInstallEta(null);
                setUpdateInstallSpeed(null);
                setIsSlowNetworkHintVisible(false);
                updateSpeedTrackerRef.current = {lastAtMs: 0, lastBytes: 0, smoothedBps: 0, slowSinceMs: 0};

                setIsLoading(false);
                setIsUpdateInstalling(false);
                return;
            }

            setStatus(message);
            showToast(message, 'info');

            void Quit();

            window.setTimeout(() => {
                setIsLoading(false);
                setIsUpdateInstalling(false);
                setRecoveryHint(t('status.updateInstallerNotOpenedHint'));
            }, 7000);
        } catch (error) {
            const feedback = toErrorFeedback(error, t('update.failed'), t);
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint || t('status.updateFailedHint'));
            setUpdateInstallLabel(t('common.installing'));
            setUpdateInstallPercent(null);
            setUpdateInstallEta(null);
            setUpdateInstallSpeed(null);
            setIsSlowNetworkHintVisible(false);
            updateSpeedTrackerRef.current = {lastAtMs: 0, lastBytes: 0, smoothedBps: 0, slowSinceMs: 0};

            setIsLoading(false);
            setIsUpdateInstalling(false);
        }
    }

    async function onUpdatePrimaryAction() {
        if (!updateInfo) {
            return;
        }

        if (!updateInfo.inAppEligible) {
            notifyInAppUpdateUnavailable();
            return;
        }

        await onInstallUpdate();
    }

    async function onRunHealthCheck() {
        try {
            setIsLoading(true);
            setStatus(t('status.runningDiagnostics'));
            setRecoveryHint('');
            const report = await RunHealthCheck();
            setHealthReport(report);
            const hasErrors = report.items.some((item) => item.severity === 'error');
            const hasWarnings = report.items.some((item) => item.severity === 'warn');
            if (hasErrors) {
                setStatus(t('common.ready'));
                showToast(t('diagnostics.toast.actionNeeded'), 'info');
            } else if (hasWarnings) {
                setStatus(t('common.ready'));
                showToast(t('diagnostics.toast.readyWithWarnings'), 'info');
            } else {
                setStatus(t('common.ready'));
                showToast(t('diagnostics.toast.ready'), 'info');
            }
        } catch (error) {
            const feedback = toErrorFeedback(error, t('error.diagnostics'), t);
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    async function onApplyPath() {
        const trimmed = saveGamePathInput.trim();
        if (!trimmed) {
            const message = t('status.pathEmpty');
            lastStatusToastRef.current = message;
            setStatus(message);
            setRecoveryHint('');
            showToast(message, 'error');
            return;
        }

        const normalized = trimmed.replace(/[\\/]+$/, '');
        if (!/[\\/]Need for speed heat[\\/]SaveGame$/i.test(normalized)) {
            const message = t('status.pathInvalidPattern');
            lastStatusToastRef.current = message;
            setStatus(message);
            setRecoveryHint('');
            showToast(message, 'error');
            return;
        }

        try {
            setIsLoading(true);
            setStatus(t('status.applyingSaveGamePath'));
            setRecoveryHint('');
            await SetSaveGamePath(trimmed);
            await loadData();
            setStatus(t('status.saveGamePathUpdated'));
        } catch (error) {
            const feedback = toErrorFeedback(error, t('error.pathUpdateFailed'), t);
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    async function onBrowseSaveGamePath(openConfirmModal = false) {
        try {
            const selectedPath = (await PickSaveGamePath()).trim();
            if (!selectedPath) {
                return;
            }

            setSaveGamePathInput(selectedPath);
            setStatus(t('status.saveGamePathSelected'));
            setRecoveryHint('');
            if (openConfirmModal) {
                setIsSavePathSetupOpen(true);
            }
        } catch (error) {
            const feedback = toErrorFeedback(error, t('error.openFolderPicker'), t);
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        }
    }

    async function onEnsureProfilesFolder(closeModalAfter = false) {
        try {
            setIsLoading(true);
            setStatus(t('status.creatingProfilesFolder'));
            setRecoveryHint('');
            await EnsureProfilesFolder();
            await loadData();
            setStatus(t('status.profilesFolderReady'));
            if (closeModalAfter) {
                setDiagnosticsModal(null);
            }
        } catch (error) {
            const feedback = toErrorFeedback(error, t('error.createProfilesFolder'), t);
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    async function onCompleteSetup() {
        try {
            setIsLoading(true);
            setStatus(t('status.completingSetup'));
            setRecoveryHint('');

            await EnsureProfilesFolder();
            const profileItems = await ListProfiles();
            await loadData();

            if (profileItems.length === 0) {
                setDiagnosticsModal('firstSave');
                setStatus(t('status.readyCreateFirstProfile'));
                return;
            }

            if (profileItems.length === 1) {
                const singleProfileName = profileItems[0].name;
                setStatus(t('status.settingActiveProfile', {name: singleProfileName}));
                await CreateMarkerFile(singleProfileName);
                setActiveProfile(singleProfileName);
                await loadData();
                setStatus(t('status.setupComplete', {name: singleProfileName}));
                return;
            }

            setMarkerDialogProfile((current) => {
                if (current && profileItems.some((profile) => profile.name === current)) {
                    return current;
                }

                return profileItems[0]?.name ?? '';
            });
            setDiagnosticsModal('marker');
            setStatus(t('status.readyChooseActive'));
        } catch (error) {
            const feedback = toErrorFeedback(error, t('error.completeSetup'), t);
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    async function onCreateMarkerFile(profileName?: string) {
        const selectedProfile = (profileName ?? markerDialogProfile).trim();
        if (!selectedProfile) {
            setStatus(t('status.selectProfileToCreateMarker'));
            return;
        }

        try {
            setIsLoading(true);
            setStatus(t('status.creatingMarker', {name: selectedProfile}));
            setRecoveryHint('');
            await CreateMarkerFile(selectedProfile);
            setActiveProfile(selectedProfile);
            await loadData();
            setStatus(t('status.markerCreated', {name: selectedProfile}));
            setDiagnosticsModal(null);
        } catch (error) {
            const feedback = toErrorFeedback(error, t('error.createMarker'), t);
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    async function onSwitch(profileName: string) {
        const previousActive = activeProfile.trim();

        try {
            setStatus(t('status.switchingProfile', {name: profileName}));
            setIsLoading(true);
            setRecoveryHint('');
            await SwitchProfile(profileName);
            setActiveProfile(profileName);
            setSelectedProfileName(profileName);
            setStatus(t('status.activeProfileNow', {name: profileName}));
        } catch (error) {
            const feedback = toErrorFeedback(error, t('error.switch'), t);
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
            setSelectedProfileName(previousActive);
        } finally {
            setIsLoading(false);
        }
    }

    function closeSwitchConfirmModal() {
        setSwitchConfirmProfile(null);
        setSelectedProfileName(activeProfile.trim());
    }

    async function confirmSwitchProfileFromModal() {
        const nextProfile = (switchConfirmProfile || '').trim();
        if (!nextProfile) {
            closeSwitchConfirmModal();
            return;
        }

        setSwitchConfirmProfile(null);
        await onSwitch(nextProfile);
    }

    async function onPrepareFresh() {
        setFreshPrepareMode(null);
        setFreshProfileName('');
        setIsFreshConfirmOpen(true);
    }

    function closeFreshFlow() {
        setIsFreshConfirmOpen(false);
        setIsFreshNameModalOpen(false);
        setFreshPrepareMode(null);
        setFreshProfileName('');
    }

    function onChooseFreshMode(preserveCurrent: boolean) {
        if (preserveCurrent && !activeProfile.trim()) {
            setStatus(t('status.saveFirstNeedsActive'));
            setRecoveryHint(t('status.saveFirstNeedsActiveHint'));
            return;
        }

        setFreshPrepareMode(preserveCurrent ? 'saveFirst' : 'skipSave');
        setIsFreshConfirmOpen(false);
        setIsFreshNameModalOpen(true);
    }

    async function onConfirmPrepareFresh() {
        const name = freshProfileName.trim();
        if (!name) {
            setStatus(t('status.chooseFreshName'));
            return;
        }

        const preserveCurrent = freshPrepareMode === 'saveFirst';
        if (!preserveCurrent && freshPrepareMode !== 'skipSave') {
            closeFreshFlow();
            return;
        }

        const currentActive = activeProfile.trim();
        const isSameAsActive = currentActive.toLowerCase() === name.toLowerCase();

        if (preserveCurrent && !currentActive) {
            setStatus(t('status.saveFirstNeedsActive'));
            setRecoveryHint(t('status.saveFirstNeedsActiveHint'));
            return;
        }

        if (preserveCurrent && isSameAsActive) {
            setStatus(t('status.freshNameMustDiffer'));
            setRecoveryHint(t('status.freshNameMustDifferHint'));
            return;
        }

        const hasExistingProfile = profiles.some((profile) => profile.name.trim().toLowerCase() === name.toLowerCase());
        if (hasExistingProfile) {
            setStatus(t('feedback.profileExists.message'));
            setRecoveryHint(t('feedback.profileExists.hint'));
            return;
        }

        try {
            setIsLoading(true);
            setStatus(preserveCurrent
                ? t('status.newSaveSavingFirst', {active: currentActive, fresh: name})
                : t('status.newSaveSkipping', {fresh: name}));
            setRecoveryHint('');
            if (preserveCurrent) {
                await PrepareFreshProfile(name);
            } else {
                await PrepareFreshProfileWithoutSave(name);
            }
            closeFreshFlow();
            setActiveProfile(name);
            await loadData();
            setStatus(preserveCurrent
                ? t('status.newSaveSavedFirst', {active: currentActive, fresh: name})
                : t('status.newSaveSkipped', {fresh: name}));
        } catch (error) {
            const feedback = toErrorFeedback(error, t('error.createProfile'), t);
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    async function onSaveCurrent() {
        if (!canSaveCurrent) {
            if (saveDestinationMode === 'active') {
                setStatus(t('status.noActiveMarkerDestination'));
            } else {
                setStatus(t('status.chooseDestinationFirst'));
            }
            return;
        }

        const target = resolvedSaveDestination;
        const requested = saveDestinationMode === 'active' ? '' : target;
        const shouldAutoSetActive = !activeProfile.trim() && needsMarkerFileFix && requested !== '';

        try {
            setIsLoading(true);
            setStatus(t('status.savingCurrentInto', {name: target}));
            setRecoveryHint('');
            await SaveCurrentProfile(requested);
            if (shouldAutoSetActive) {
                await CreateMarkerFile(target);
                setActiveProfile(target);
            }
            if (saveDestinationProfile === NEW_PROFILE_OPTION) {
                setSaveDestinationNewName('');
            }
            await loadData();
            setStatus(shouldAutoSetActive
                ? t('status.savedCurrentAndSetActive', {name: target})
                : t('status.savedCurrent', {name: target}));
        } catch (error) {
            const feedback = toErrorFeedback(error, t('error.saveCurrent'), t);
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    async function onExportBundle() {
        const profileName = exportProfileName.trim();
        if (!profileName) {
            setStatus(t('status.chooseProfileToExport'));
            return;
        }

        const bundlePath = buildExportBundlePath(saveGamePath, profileName);

        try {
            setIsLoading(true);
            setStatus(t('status.exportingBundle', {name: profileName}));
            setRecoveryHint('');
            await ExportProfileBundle(profileName, bundlePath);
            setStatus(t('status.bundleExported', {path: bundlePath}));
            setIsExportModalOpen(false);
        } catch (error) {
            const feedback = toErrorFeedback(error, t('error.exportBundle'), t);
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    async function onImportBundle() {
        const profileName = resolvedImportTarget;
        const bundlePath = importBundlePath.trim();
        if (!profileName) {
            setStatus(importTargetProfile === NEW_PROFILE_OPTION ? t('status.enterImportProfileName') : t('status.chooseImportDestination'));
            return;
        }

        if (!bundlePath) {
            setStatus(t('status.chooseBundleFirst'));
            return;
        }

        try {
            setIsLoading(true);
            setStatus(t('status.importingBundle', {name: profileName}));
            setRecoveryHint('');
            await ImportProfileBundle(profileName, bundlePath);
            await loadData();
            setStatus(t('status.bundleImported', {name: profileName}));
            setIsImportModalOpen(false);
        } catch (error) {
            const feedback = toErrorFeedback(error, t('error.importBundle'), t);
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    async function onPickImportBundlePath() {
        try {
            const selected = await PickImportBundlePath();
            if (selected) {
                setImportBundlePath(selected);
            }
        } catch (error) {
            const feedback = toErrorFeedback(error, t('error.openFilePicker'), t);
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        }
    }

    function openRenameModal(profileName: string) {
        setRenameTarget(profileName);
        setRenameValue(profileName);
    }

    function closeRenameModal() {
        setRenameTarget(null);
        setRenameValue('');
    }

    async function confirmRenameProfile() {
        if (!renameTarget) {
            return;
        }

        const nextName = renameValue.trim();
        if (!nextName || nextName === renameTarget) {
            closeRenameModal();
            return;
        }

        try {
            setIsLoading(true);
            setStatus(t('status.renamingProfile', {oldName: renameTarget, newName: nextName}));
            setRecoveryHint('');
            await RenameProfile(renameTarget, nextName);
            await loadData();
            setStatus(t('status.profileRenamed', {name: nextName}));
            closeRenameModal();
        } catch (error) {
            const feedback = toErrorFeedback(error, t('error.rename'), t);
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    function openDeleteModal(profileName?: string) {
        if (!hasDeletableProfiles) {
            return;
        }

        const requested = (profileName || '').trim();
        const fallback = deletableProfiles[0]?.name ?? null;
        const nextTarget = requested && deletableProfiles.some((profile) => profile.name === requested)
            ? requested
            : fallback;

        setDeleteTarget(nextTarget);
    }

    function closeDeleteModal() {
        setDeleteTarget(null);
    }

    function openDiagnosticsModal(action: DiagnosticsQuickAction) {
        if (action === 'marker') {
            setMarkerDialogProfile((current) => {
                if (current && profiles.some((profile) => profile.name === current)) {
                    return current;
                }

                return profiles[0]?.name ?? '';
            });
        }

        setDiagnosticsModal(action);
    }

    function closeDiagnosticsModal() {
        setDiagnosticsModal(null);
        setFirstSaveProfileName('');
    }

    function openExportModal() {
        setExportProfileName(() => {
            if (activeProfile.trim() && profiles.some((profile) => profile.name === activeProfile)) {
                return activeProfile;
            }

            return profiles[0]?.name ?? '';
        });
        setIsExportModalOpen(true);
    }

    function closeExportModal() {
        setIsExportModalOpen(false);
    }

    function openImportModal() {
        setImportTargetProfile(() => {
            if (activeProfile.trim() && profiles.some((profile) => profile.name === activeProfile)) {
                return activeProfile;
            }

            return profiles[0]?.name ?? NEW_PROFILE_OPTION;
        });
        setImportTargetNewName('');
        setIsImportModalOpen(true);
    }

    function closeImportModal() {
        setIsImportModalOpen(false);
    }

    async function onSaveCurrentFromModal() {
        const profileName = firstSaveProfileName.trim();
        if (!profileName) {
            setStatus(t('status.enterNameBeforeSavingCurrent'));
            return;
        }

        try {
            setIsLoading(true);
            setStatus(t('status.savingCurrentInto', {name: profileName}));
            setRecoveryHint('');
            await SaveCurrentProfile(profileName);

            const shouldAutoSetActive = !activeProfile.trim() && needsMarkerFileFix;
            if (shouldAutoSetActive) {
                await CreateMarkerFile(profileName);
                setActiveProfile(profileName);
            }

            await loadData();
            setDiagnosticsModal(null);
            setFirstSaveProfileName('');
            setStatus(shouldAutoSetActive
                ? t('status.savedCurrentAndSetActive', {name: profileName})
                : t('status.savedCurrent', {name: profileName}));
        } catch (error) {
            const feedback = toErrorFeedback(error, t('error.saveCurrent'), t);
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    function closeActiveModal() {
        if (isSavePathSetupOpen) {
            setIsSavePathSetupOpen(false);
            return;
        }

        if (switchConfirmProfile) {
            closeSwitchConfirmModal();
            return;
        }

        if (renameTarget) {
            closeRenameModal();
            return;
        }

        if (deleteTarget) {
            closeDeleteModal();
            return;
        }

        if (diagnosticsModal) {
            closeDiagnosticsModal();
            return;
        }

        if (isFreshNameModalOpen || isFreshConfirmOpen) {
            closeFreshFlow();
            return;
        }

        if (isExportModalOpen) {
            closeExportModal();
            return;
        }

        if (isImportModalOpen) {
            closeImportModal();
        }
    }

    async function confirmDeleteProfile() {
        if (!deleteTarget) {
            return;
        }

        try {
            setIsLoading(true);
            setStatus(t('status.deletingProfile', {name: deleteTarget}));
            setRecoveryHint('');
            await DeleteProfile(deleteTarget);
            await loadData();
            setStatus(t('status.profileDeleted', {name: deleteTarget}));
            closeDeleteModal();
        } catch (error) {
            const feedback = toErrorFeedback(error, t('error.delete'), t);
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    useEffect(() => {
        void loadLanguagePreference();
    }, []);

    useEffect(() => {
        if (!isLanguageReady) {
            return;
        }

        void loadData();
        void checkForUpdates();
    }, [isLanguageReady]);

    useEffect(() => {
        const unsubscribe = EventsOn(updateProgressEventName, (payload: UpdateProgressEvent) => {
            const stage = (payload?.stage || '').trim().toLowerCase();
            const message = localizeUpdaterMessage((payload?.message || '').trim(), t);
            const downloadedBytes = Math.max(0, Number(payload?.downloadedBytes || 0));
            const totalBytes = Math.max(0, Number(payload?.totalBytes || 0));
            const rawPercent = Number(payload?.percent);
            const normalizedPercent = Number.isFinite(rawPercent)
                ? Math.max(0, Math.min(100, Math.round(rawPercent)))
                : null;

            if (message && stage !== 'downloading') {
                setStatus(message);
            }

            if (stage === 'validating' || stage === 'downloading' || stage === 'downloaded' || stage === 'launching') {
                setIsLoading(true);
                setIsUpdateInstalling(true);
                setRecoveryHint('');

                if (stage === 'downloading') {
                    const downloadingLabel = t('update.downloading').replace('...', '');
                    const bytesLabel = totalBytes > 0
                        ? `${downloadingLabel} ${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`
                        : `${downloadingLabel} ${formatBytes(downloadedBytes)}`;
                    setUpdateInstallLabel(bytesLabel);
                    setUpdateInstallPercent(normalizedPercent);

                    if (totalBytes > 0) {
                        const nowMs = Date.now();
                        const tracker = updateSpeedTrackerRef.current;

                        if (tracker.lastAtMs > 0 && downloadedBytes >= tracker.lastBytes) {
                            const deltaBytes = downloadedBytes - tracker.lastBytes;
                            const deltaSeconds = (nowMs - tracker.lastAtMs) / 1000;

                            if (deltaBytes > 0 && deltaSeconds > 0.05) {
                                const instantBps = deltaBytes / deltaSeconds;
                                tracker.smoothedBps = tracker.smoothedBps > 0
                                    ? tracker.smoothedBps * 0.72 + instantBps * 0.28
                                    : instantBps;
                            }
                        }

                        tracker.lastAtMs = nowMs;
                        tracker.lastBytes = downloadedBytes;

                        if (tracker.smoothedBps > 0) {
                            const remainingBytes = Math.max(0, totalBytes - downloadedBytes);
                            setUpdateInstallSpeed(formatRate(tracker.smoothedBps));
                            setUpdateInstallEta(formatEta(remainingBytes / tracker.smoothedBps));

                            const isSlowSpeed = tracker.smoothedBps < slowNetworkThresholdBps && downloadedBytes < totalBytes;
                            if (isSlowSpeed) {
                                if (tracker.slowSinceMs === 0) {
                                    tracker.slowSinceMs = nowMs;
                                }

                                setIsSlowNetworkHintVisible(nowMs - tracker.slowSinceMs >= slowNetworkDelayMs);
                            } else {
                                tracker.slowSinceMs = 0;
                                setIsSlowNetworkHintVisible(false);
                            }
                        } else {
                            setUpdateInstallSpeed(null);
                            setUpdateInstallEta(null);
                            setIsSlowNetworkHintVisible(false);
                            tracker.slowSinceMs = 0;
                        }
                    } else {
                        setUpdateInstallSpeed(null);
                        setUpdateInstallEta(null);
                        setIsSlowNetworkHintVisible(false);
                        updateSpeedTrackerRef.current.slowSinceMs = 0;
                    }
                } else if (stage === 'validating') {
                    setUpdateInstallLabel(t('update.validating'));
                    setUpdateInstallPercent(null);
                    setUpdateInstallEta(null);
                    setUpdateInstallSpeed(null);
                    setIsSlowNetworkHintVisible(false);
                    updateSpeedTrackerRef.current = {lastAtMs: 0, lastBytes: 0, smoothedBps: 0, slowSinceMs: 0};
                } else if (stage === 'downloaded' || stage === 'launching') {
                    setUpdateInstallLabel(t('update.launchingInstaller'));
                    setUpdateInstallPercent(100);
                    setUpdateInstallEta(null);
                    setUpdateInstallSpeed(null);
                    setIsSlowNetworkHintVisible(false);
                }

                return;
            }

            if (stage === 'launched') {
                setUpdateInstallLabel(t('update.closingApp'));
                setUpdateInstallPercent(100);
                setUpdateInstallEta(null);
                setUpdateInstallSpeed(null);
                setIsSlowNetworkHintVisible(false);
            }

            if (stage === 'failed') {
                setIsLoading(false);
                setIsUpdateInstalling(false);
                setUpdateInstallLabel(t('common.installing'));
                setUpdateInstallPercent(null);
                setUpdateInstallEta(null);
                setUpdateInstallSpeed(null);
                setIsSlowNetworkHintVisible(false);
                updateSpeedTrackerRef.current = {lastAtMs: 0, lastBytes: 0, smoothedBps: 0, slowSinceMs: 0};
            }
        });

        return () => {
            unsubscribe();
        };
    }, [t]);

    useEffect(() => {
        if (!isModalOpen) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !isLoading) {
                event.preventDefault();
                closeActiveModal();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isModalOpen, isLoading, switchConfirmProfile, renameTarget, deleteTarget, diagnosticsModal, isExportModalOpen, isImportModalOpen, isFreshConfirmOpen, isFreshNameModalOpen]);

    useEffect(() => {
        if (importTargetProfile === NEW_PROFILE_OPTION) {
            importNewProfileRef.current?.focus();
        }
    }, [importTargetProfile]);

    useEffect(() => {
        const message = status.trim();
        if (!message || message.toLowerCase() === t('common.ready').toLowerCase()) {
            return;
        }

        if (message === lastStatusToastRef.current) {
            return;
        }

        lastStatusToastRef.current = message;
        showToast(message, inferStatusToastKind(message));
    }, [status, t]);

    useEffect(() => {
        const hint = recoveryHint.trim();
        if (!hint) {
            return;
        }

        if (hint === lastRecoveryToastRef.current) {
            return;
        }

        lastRecoveryToastRef.current = hint;
        showToast(t('toast.tipPrefix', {hint}), 'info');
    }, [recoveryHint, t]);

    useEffect(() => {
        if (status.trim().toLowerCase() !== t('common.ready').toLowerCase()) {
            return;
        }

        if (toastMessage.toLowerCase().includes(t('status.loadingProfiles').toLowerCase())) {
            setToastMessage('');
        }
    }, [status, toastMessage, t]);

    useEffect(() => {
        if (!toastMessage) {
            return;
        }

        if (toastTimerRef.current !== null) {
            window.clearTimeout(toastTimerRef.current);
        }

        toastTimerRef.current = window.setTimeout(() => {
            setToastMessage('');
            toastTimerRef.current = null;
        }, toastVisibilityMs);

        return () => {
            if (toastTimerRef.current !== null) {
                window.clearTimeout(toastTimerRef.current);
                toastTimerRef.current = null;
            }
        };
    }, [toastMessage, toastSequence]);

    return (
        <div className={`app-shell${hasQuickActions ? ' quick-actions-focus' : ''}`}>
            <header className="hero">
                <p className="eyebrow"><Zap size={11} strokeWidth={2.3} /> {t('hero.eyebrow')}</p>
                <h1>{t('hero.title')}</h1>
                <div className="hero-actions">
                    <p className="current-profile">{t('hero.currentProfile')}: <strong>{activeProfile || t('common.noneSelected')}</strong></p>
                    <button className="top-refresh-btn" onClick={() => void loadData(true)} disabled={isLoading || isModalOpen}>
                        <RefreshCw size={13} strokeWidth={2.2} className={isLoading ? 'spin' : ''} /> {t('hero.refresh')}
                    </button>
                </div>
                <p className={`status ${diagnosticsStatusClass}`}><span className="status-dot" aria-hidden="true" /> {diagnosticsStatusLabel}</p>
                {updateInfo?.updateAvailable && !isUpdateDismissed && (
                    <div className="update-banner" role="status" aria-live="polite">
                        <div className="update-banner-copy">
                            <strong>{t('update.newVersionAvailable', {version: updateInfo.latestVersion})}</strong>
                            <span className="update-current">{t('update.currentVersion', {version: appVersion || updateInfo.currentVersion || t('update.unknownVersion')})}</span>
                            {!isInAppUpdateEligible && (
                                <span className="update-progress-hint">{getInAppUpdateUnavailableMessage()}</span>
                            )}
                            {isUpdateInstalling && (
                                <div className="update-progress-wrap">
                                    <div className="update-progress-row">
                                        <span className="update-progress-label">{updateInstallLabel}</span>
                                        {(updateInstallPercent !== null || updateInstallSpeed || updateInstallEta) && (
                                            <span className="update-progress-meta">
                                                {updateInstallPercent !== null ? `${updateInstallPercent}%` : ''}
                                                {updateInstallSpeed ? (updateInstallPercent !== null ? ` | ${updateInstallSpeed}` : updateInstallSpeed) : ''}
                                                {updateInstallEta
                                                    ? ((updateInstallPercent !== null || updateInstallSpeed) ? ` | ${updateInstallEta}` : updateInstallEta)
                                                    : ''}
                                            </span>
                                        )}
                                    </div>
                                    <div
                                        className={`update-progress-track${updateInstallPercent === null ? ' is-indeterminate' : ''}`}
                                        role="progressbar"
                                        aria-label={t('update.progressAriaLabel')}
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                        aria-valuenow={updateInstallPercent ?? undefined}
                                        aria-valuetext={updateInstallPercent !== null ? `${updateInstallPercent}%` : updateInstallLabel}
                                    >
                                        <span
                                            className="update-progress-fill"
                                            style={updateInstallPercent !== null ? {width: `${updateInstallPercent}%`} : undefined}
                                        />
                                    </div>
                                    {isSlowNetworkHintVisible && (
                                        <span className="update-progress-hint">{t('update.slowNetwork')}</span>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="update-banner-actions">
                            <button className="switch-btn secondary" onClick={() => setIsUpdateDismissed(true)} disabled={isLoading || isModalOpen}>
                                {t('common.later')}
                            </button>
                            <button
                                className="switch-btn secondary"
                                onClick={() => void onOpenUpdateLink(updateInfo.releaseUrl || updateInfo.downloadUrl, t('update.openReleasePage'))}
                                disabled={isLoading || isModalOpen || !(updateInfo.releaseUrl || updateInfo.downloadUrl)}
                            >
                                {t('common.viewNotes')}
                            </button>
                            <button
                                className="action-btn"
                                onClick={() => void onUpdatePrimaryAction()}
                                disabled={isLoading || isUpdateInstalling || isModalOpen}
                            >
                                {isUpdateInstalling ? t('common.installing') : updatePrimaryLabel}
                            </button>
                        </div>
                    </div>
                )}
            </header>

            <main className="dashboard workspace-layout">
                <section className="panel diagnostics-panel side-panel">
                    <div className="panel-header-row diag-header">
                        <h2>{t('diagnostics.title')}</h2>
                        <span className={`diag-pill ${diagnosticsStatusClass}`}>
                            <span className="diag-pill-dot" aria-hidden="true" />
                            {diagnosticsStatusLabel}
                        </span>
                    </div>
                    <p className="diag-last-run">{t('diagnostics.lastRun', {value: healthReport?.checkedAt ? new Date(healthReport.checkedAt).toLocaleString() : t('diagnostics.lastRunNotRunYet')})}</p>
                    <button className="diag-run-btn" onClick={() => void onRunHealthCheck()} disabled={isLoading || isModalOpen}>
                        <span className="diag-run-glow" aria-hidden="true" />
                        <span className="diag-run-label">
                            {isLoading ? t('diagnostics.running') : (<><Zap size={13} strokeWidth={2.15} /> {t('diagnostics.run')}</>)}
                        </span>
                    </button>
                    {(needsSaveGamePathFix || needsProfilesFolderFix || needsMarkerFileFix) && (
                        <div className="diag-actions">
                            <h3>{t('diagnostics.quickActions')}</h3>
                            <p className="diag-callout">{t('diagnostics.callout')}</p>
                            {needsSaveGamePathFix && (
                                <button className="action-btn secondary attention" onClick={() => setIsSavePathSetupOpen(true)} disabled={isLoading || isModalOpen}>
                                    {t('diagnostics.setSaveGamePath')}
                                </button>
                            )}
                            {needsCombinedSetupFix ? (
                                <button className="action-btn secondary attention" onClick={() => void onCompleteSetup()} disabled={isLoading || isModalOpen}>
                                    {t('diagnostics.completeSetup')}
                                </button>
                            ) : (
                                <>
                                    {needsProfilesFolderFix && (
                                        <button className="action-btn secondary attention" onClick={() => openDiagnosticsModal('profiles')} disabled={isLoading || isModalOpen}>
                                            {t('diagnostics.createProfilesFolder')}
                                        </button>
                                    )}
                                    {needsMarkerFileFix && (
                                        <button className="action-btn secondary attention" onClick={() => openDiagnosticsModal('marker')} disabled={isLoading || isModalOpen}>
                                            {t('diagnostics.setActiveProfile')}
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                    {healthReport && (
                        <ul className="health-list">
                            {healthReport.items.map((item) => (
                                <li key={item.name} className={`health-item ${item.severity}`}>
                                    <span className={`health-state ${item.severity}`} aria-hidden="true">
                                        {item.severity === 'ok' ? <CheckCircle2 size={16} strokeWidth={2.2} /> : item.severity === 'warn' ? <AlertTriangle size={16} strokeWidth={2.1} /> : <CircleX size={16} strokeWidth={2.1} />}
                                    </span>
                                    <div className="health-title">
                                        <span className="health-item-icon" aria-hidden="true">{getDiagnosticItemIcon(item.name)}</span>
                                        <strong>{localizeHealthItemName(item.name, t)}</strong>
                                    </div>
                                    <span className="health-message">{localizeHealthMessage(item.message, t)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                <div className="primary-stack">
                <section className="panel profile-section-card">
                    <div className="panel-block">
                        <div className="panel-header-row">
                            <h2>{t('profiles.title')}</h2>
                            <span className="field-hint">{t('profiles.active')}: <strong>{activeProfile || t('common.noneSelected')}</strong></span>
                        </div>

                        {profiles.length > 0 ? (
                            <div className="profile-toolbar">
                                <div className="profile-select-wrap">
                                    <select
                                        className={selectedIsActive ? 'has-active-tag' : ''}
                                        value={selectedProfileName}
                                        onChange={(event) => {
                                            const next = event.target.value;
                                            if (!next) {
                                                return;
                                            }

                                            setSelectedProfileName(next);

                                            if (next.trim().toLowerCase() !== activeProfile.trim().toLowerCase()) {
                                                setSwitchConfirmProfile(next);
                                            }
                                        }}
                                        disabled={isLoading || isModalOpen}
                                        aria-label={t('profiles.selectAria')}
                                    >
                                        <option value="" disabled>
                                            {activeProfile ? t('profiles.selectProfile') : t('profiles.noActiveProfileSelected')}
                                        </option>
                                        {profiles.map((profile) => (
                                            <option key={profile.name} value={profile.name}>
                                                {profile.name}
                                            </option>
                                        ))}
                                    </select>
                                    {selectedIsActive && (
                                        <span className="profile-active-tag" style={{left: `calc(0.92rem + ${Math.min(selectedProfileName.length + 2, 16)}ch)`}}>
                                            {t('profiles.activeTag')}
                                        </span>
                                    )}
                                </div>
                                <button
                                    className="switch-btn secondary"
                                    onClick={() => openRenameModal(selectedProfileName)}
                                    disabled={isLoading || isModalOpen || !hasSelectedProfile}
                                    aria-label={t('profiles.renameSelectedAria')}
                                >
                                    <Edit3 size={13} strokeWidth={2.1} />
                                    {t('common.rename')}
                                </button>
                                <button
                                    className="switch-btn danger"
                                    onClick={() => openDeleteModal(selectedProfileName)}
                                    disabled={isLoading || isModalOpen || !hasDeletableProfiles}
                                    aria-label={t('profiles.deleteSelectedAria')}
                                >
                                    <Trash2 size={13} strokeWidth={2.1} />
                                    {t('common.delete')}
                                </button>
                            </div>
                        ) : (
                            <div>
                                <p className="empty">{t('profiles.empty')}</p>
                                <p className="field-hint">{t('profiles.emptyHint')}</p>
                            </div>
                        )}
                    </div>

                </section>

                <section className="panel save-actions-panel" ref={saveActionsRef}>
                    <h2>{t('saveActions.title')}</h2>
                    <div className="save-actions-grid">
                        <div className="setup-group save-card start-save-card">
                            <div className="save-card-head">
                                <p className="field-label">{t('saveActions.startNewTitle')}</p>
                            </div>
                            <p className="save-card-copy">{t('saveActions.startNewDescription')}</p>
                            <button className="action-btn" onClick={() => void onPrepareFresh()} disabled={isLoading || isModalOpen}>
                                <Plus size={14} strokeWidth={2.2} />
                                {t('saveActions.startNewButton')}
                            </button>
                        </div>

                        <div className="setup-group save-current-group save-card save-progress-card">
                            <div className="save-card-head">
                                <span className="save-card-icon" aria-hidden="true"><Save size={13} strokeWidth={2.2} /></span>
                                <label className="field-label" htmlFor="save-profile-input">{t('saveActions.saveCurrentTitle')}</label>
                            </div>
                            <div className="save-mode-row" role="radiogroup" aria-label={t('saveActions.destinationModeAria')}>
                                <label className="save-mode-option">
                                    <input
                                        type="radio"
                                        checked={saveDestinationMode === 'active'}
                                        onChange={() => setSaveDestinationMode('active')}
                                        disabled={isLoading || isModalOpen || !hasActiveDestination}
                                    />
                                    <span className={!hasActiveDestination ? 'disabled-option' : ''}>{hasActiveDestination ? t('saveActions.useActive', {name: activeProfile}) : t('saveActions.useActiveUnavailable')}</span>
                                </label>
                                <label className="save-mode-option">
                                    <input
                                        type="radio"
                                        checked={saveDestinationMode === 'custom'}
                                        onChange={() => setSaveDestinationMode('custom')}
                                        disabled={isLoading || isModalOpen}
                                    />
                                    <span>{t('saveActions.chooseDestination')}</span>
                                </label>
                            </div>

                            {saveDestinationMode === 'custom' && (
                                <div className="save-destination-grid">
                                    <select
                                        id="save-profile-input"
                                        value={saveDestinationProfile}
                                        onChange={(event) => setSaveDestinationProfile(event.target.value)}
                                        disabled={isLoading || isModalOpen}
                                    >
                                        {profiles.map((profile) => (
                                            <option key={profile.name} value={profile.name}>
                                                {profile.name}{profile.name === activeProfile ? t('saveActions.activeSuffix') : ''}
                                            </option>
                                        ))}
                                        <option value={NEW_PROFILE_OPTION}>{t('saveActions.createNewProfileOption')}</option>
                                    </select>
                                    {saveDestinationProfile === NEW_PROFILE_OPTION && (
                                        <input
                                            value={saveDestinationNewName}
                                            onChange={(event) => setSaveDestinationNewName(event.target.value)}
                                            placeholder={t('saveActions.newProfilePlaceholder')}
                                            disabled={isLoading || isModalOpen}
                                        />
                                    )}
                                </div>
                            )}

                            <p className="field-hint">
                                {t('saveActions.destinationSummary', {name: resolvedSaveDestination || t('saveActions.destinationNotSelected')})}
                            </p>
                            {!hasActiveDestination && saveDestinationMode === 'active' && (
                                <p className="field-hint">{t('saveActions.noActiveHint')}</p>
                            )}
                            <div className="field-row">
                                <button className="action-btn secondary" onClick={() => void onSaveCurrent()} disabled={isLoading || isModalOpen || !canSaveCurrent}>
                                    <Save size={15} strokeWidth={2.2} /> {t('saveActions.saveProgressButton')}
                                </button>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="panel save-setup-panel">
                    <h2>{t('saveSetup.title')}</h2>
                    <div className="setup-group save-setup-inner-card">
                        <label className="field-label savegame-path-label" htmlFor="savegame-path-input">
                            <FolderOpen size={13} strokeWidth={2} />
                            <span>{t('saveSetup.pathLabel')}</span>
                        </label>
                        <p className="path">{saveGamePath ? maskWindowsUserPath(saveGamePath) : t('common.notSet')}</p>
                        <div className="field-row savegame-path-row">
                            <input
                                id="savegame-path-input"
                                value={saveGamePathInput}
                                onChange={(event) => setSaveGamePathInput(event.target.value)}
                                placeholder={t('saveSetup.placeholder')}
                                disabled={isLoading || isModalOpen}
                            />
                            <button className="action-btn secondary" onClick={() => void onBrowseSaveGamePath(true)} disabled={isLoading || isModalOpen}>
                                {t('common.browse')}
                            </button>
                        </div>
                        <p className="field-hint">{t('saveSetup.pathHint')}</p>
                    </div>
                    <div className="setup-group preferences-inner-card">
                        <label className="field-label" htmlFor="language-select">{t('saveSetup.preferencesTitle')}</label>
                        <div className="field-row language-row">
                            <span className="field-label language-label">{t('language.label')}</span>
                            <select
                                id="language-select"
                                value={language}
                                onChange={(event) => void onChangeLanguage(event.target.value)}
                                disabled={isLoading || isModalOpen}
                            >
                                <option value="en">{getLanguageLabel('en', t)}</option>
                                <option value="es">{getLanguageLabel('es', t)}</option>
                            </select>
                        </div>
                        <p className="field-hint">{t('language.hint')}</p>
                    </div>
                </section>

                <section className="panel advanced-panel">
                    <div className="bundle-header-row">
                        <div>
                            <h2>{t('advanced.title')}</h2>
                            <p className="field-hint">{t('advanced.hint')}</p>
                        </div>
                        <button
                            className="switch-btn secondary advanced-toggle-btn"
                            onClick={() => setIsBundleExpanded((open) => !open)}
                            disabled={isLoading || isModalOpen}
                            aria-expanded={isBundleExpanded}
                            aria-controls="bundle-transfer-content"
                        >
                            {isBundleExpanded ? (<><span>{t('common.hide')}</span><ChevronUp size={14} strokeWidth={2.2} /></>) : (<><span>{t('common.show')}</span><ChevronDown size={14} strokeWidth={2.2} /></>)}
                        </button>
                    </div>

                    {isBundleExpanded && (
                        <div id="bundle-transfer-content" className="bundle-content">
                            <div className="advanced-cards-grid">
                                <div className="advanced-tool-card export-tool-card">
                                    <div className="advanced-tool-head">
                                        <span className="advanced-tool-icon" aria-hidden="true"><Download size={14} strokeWidth={2.1} /></span>
                                        <h3>{t('advanced.exportTitle')}</h3>
                                    </div>
                                    <p className="advanced-tool-copy">{t('advanced.exportHint')}</p>
                                    {profiles.length === 0 && <p className="field-hint">{t('advanced.exportEmptyHint')}</p>}
                                    <button className="action-btn advanced-tool-action export-action" onClick={openExportModal} disabled={isLoading || isModalOpen || profiles.length === 0}>
                                        <Download size={14} strokeWidth={2.1} /> {t('advanced.exportButton')}
                                    </button>
                                </div>

                                <div className="advanced-tool-card import-tool-card">
                                    <div className="advanced-tool-head">
                                        <span className="advanced-tool-icon" aria-hidden="true"><Upload size={14} strokeWidth={2.1} /></span>
                                        <h3>{t('advanced.importTitle')}</h3>
                                    </div>
                                    <p className="advanced-tool-copy">{t('advanced.importHint')}</p>
                                    <button className="action-btn secondary advanced-tool-action import-action" onClick={openImportModal} disabled={isLoading || isModalOpen}>
                                        <Upload size={14} strokeWidth={2.1} /> {t('advanced.importButton')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </section>
                </div>
            </main>
            <footer className="footnote">
                <p>{t('footer.markerFile')}</p>
            </footer>

            {toastMessage && (
                <div className={`toast ${toastKind === 'info' ? 'toast-info' : toastKind === 'error' ? 'toast-error' : 'toast-success'}`} role="status" aria-live="polite">
                    {toastKind === 'error'
                        ? <AlertTriangle size={16} strokeWidth={2.2} />
                        : toastKind === 'info'
                            ? <Info size={16} strokeWidth={2.2} />
                            : <CheckCircle2 size={16} strokeWidth={2.2} />} {toastMessage}
                </div>
            )}

            {isSavePathSetupOpen && (
                <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="save-path-setup-title" aria-describedby="save-path-setup-description">
                    <div className="modal-card save-path-setup-card" onClick={(event) => event.stopPropagation()}>
                        <h3 id="save-path-setup-title">{t('modal.savePath.title')}</h3>
                        <p id="save-path-setup-description">
                            {t('modal.savePath.description')}
                        </p>
                        <p className="modal-note">{t('modal.savePath.detectedPath', {path: saveGamePath ? maskWindowsUserPath(saveGamePath) : t('common.notDetected')})}</p>
                        <label className="field-label" htmlFor="startup-savegame-path-input">{t('modal.savePath.fieldLabel')}</label>
                        <input
                            id="startup-savegame-path-input"
                            value={saveGamePathInput}
                            onChange={(event) => setSaveGamePathInput(event.target.value)}
                            placeholder={t('saveSetup.placeholder')}
                            disabled={isLoading}
                            autoFocus
                        />
                        <p className="field-hint">{t('saveSetup.pathHint')}</p>
                        <div className="modal-actions">
                            <button
                                className="switch-btn secondary"
                                onClick={() => setIsSavePathSetupOpen(false)}
                                disabled={isLoading}
                            >
                                {t('common.closeForNow')}
                            </button>
                            <button
                                className="switch-btn secondary"
                                onClick={() => void onBrowseSaveGamePath()}
                                disabled={isLoading}
                            >
                                {t('common.browse')}
                            </button>
                            <button
                                className="switch-btn secondary"
                                onClick={() => setSaveGamePathInput(saveGamePath)}
                                disabled={isLoading || !saveGamePath}
                            >
                                {t('modal.savePath.useDetected')}
                            </button>
                            <button className="action-btn" onClick={() => void onApplyPath()} disabled={isLoading || !canApplyPath}>
                                {isLoading ? t('modal.savePath.applying') : t('modal.savePath.confirm')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isFreshConfirmOpen && (
                <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="fresh-confirm-modal-title" aria-describedby="fresh-confirm-modal-description">
                    <div className="modal-card" onClick={(event) => event.stopPropagation()}>
                        <h3 id="fresh-confirm-modal-title">{t('modal.freshConfirm.title')}</h3>
                        <p id="fresh-confirm-modal-description">
                            {t('modal.freshConfirm.description', {
                                active: activeProfile || t('modal.freshConfirm.defaultActive'),
                            })}
                        </p>
                        {!activeProfile.trim() && (
                            <p className="modal-note">
                                {t('modal.freshConfirm.saveUnavailable')}
                            </p>
                        )}
                        <p className="modal-note">
                            {t('modal.freshConfirm.note')}
                        </p>
                        <div className="modal-actions">
                            <button className="switch-btn secondary" onClick={closeFreshFlow} disabled={isLoading}>
                                {t('common.cancel')}
                            </button>
                            <button className="switch-btn secondary" onClick={() => onChooseFreshMode(false)} disabled={isLoading}>
                                {t('modal.freshConfirm.skipSave')}
                            </button>
                            <button
                                className="action-btn"
                                onClick={() => onChooseFreshMode(true)}
                                disabled={isLoading || !activeProfile.trim()}
                            >
                                {t('modal.freshConfirm.saveFirst')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isFreshNameModalOpen && (
                <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="fresh-name-modal-title" aria-describedby="fresh-name-modal-description">
                    <div className="modal-card fresh-name-modal-card" onClick={(event) => event.stopPropagation()}>
                        <h3 id="fresh-name-modal-title">{t('modal.freshName.title')}</h3>
                        <p id="fresh-name-modal-description">{t('modal.freshName.description')}</p>
                        <label className="field-label" htmlFor="fresh-profile-modal-input">{t('modal.freshName.label')}</label>
                        <input
                            id="fresh-profile-modal-input"
                            value={freshProfileName}
                            onChange={(event) => setFreshProfileName(event.target.value)}
                            placeholder={t('saveActions.newProfilePlaceholder')}
                            disabled={isLoading}
                            autoFocus
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    void onConfirmPrepareFresh();
                                }
                            }}
                        />
                        <div className="modal-actions">
                            <button className="switch-btn secondary" onClick={closeFreshFlow} disabled={isLoading}>
                                {t('common.cancel')}
                            </button>
                            <button className="action-btn" onClick={() => void onConfirmPrepareFresh()} disabled={isLoading || !freshProfileName.trim()}>
                                <Plus size={14} strokeWidth={2.2} />
                                {t('saveActions.startNewButton')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {switchConfirmProfile && (
                <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="switch-confirm-modal-title" aria-describedby="switch-confirm-modal-description">
                    <div className="modal-card" onClick={(event) => event.stopPropagation()}>
                        <h3 id="switch-confirm-modal-title">{t('modal.switch.title')}</h3>
                        <p id="switch-confirm-modal-description">
                            {t('modal.switch.description', {current: activeProfile || t('common.noneSelected'), next: switchConfirmProfile})}
                        </p>
                        <p className="modal-note">{t('modal.switch.note')}</p>
                        <div className="modal-actions">
                            <button className="switch-btn secondary" onClick={closeSwitchConfirmModal} disabled={isLoading}>
                                {t('common.cancel')}
                            </button>
                            <button className="action-btn" onClick={() => void confirmSwitchProfileFromModal()} disabled={isLoading}>
                                {isLoading ? t('modal.switch.switching') : t('modal.switch.button')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {diagnosticsModal && (
                <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="diag-modal-title" aria-describedby="diag-modal-description">
                    <div className="modal-card" onClick={(event) => event.stopPropagation()}>
                        {diagnosticsModal === 'profiles' ? (
                            <>
                                <h3 id="diag-modal-title">{t('modal.diag.profiles.title')}</h3>
                                <p id="diag-modal-description">
                                    {t('modal.diag.profiles.description')}
                                </p>
                                <div className="modal-actions">
                                    <button className="switch-btn secondary" onClick={closeDiagnosticsModal} disabled={isLoading}>
                                        {t('common.cancel')}
                                    </button>
                                    <button className="action-btn" onClick={() => void onEnsureProfilesFolder(true)} disabled={isLoading}>
                                        {t('modal.diag.profiles.button')}
                                    </button>
                                </div>
                            </>
                        ) : diagnosticsModal === 'firstSave' ? (
                            <>
                                <h3 id="diag-modal-title">{t('modal.diag.firstSave.title')}</h3>
                                <p id="diag-modal-description">
                                    {t('modal.diag.firstSave.description')}
                                </p>
                                <input
                                    value={firstSaveProfileName}
                                    onChange={(event) => setFirstSaveProfileName(event.target.value)}
                                    placeholder={t('saveActions.newProfilePlaceholder')}
                                    disabled={isLoading}
                                    autoFocus
                                />
                                <div className="modal-actions">
                                    <button className="switch-btn secondary" onClick={closeDiagnosticsModal} disabled={isLoading}>
                                        {t('common.cancel')}
                                    </button>
                                    <button className="action-btn" onClick={() => void onSaveCurrentFromModal()} disabled={isLoading || !firstSaveProfileName.trim()}>
                                        {t('modal.diag.firstSave.button')}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <h3 id="diag-modal-title">{t('modal.diag.marker.title')}</h3>
                                <p id="diag-modal-description">
                                    {t('modal.diag.marker.description')}
                                </p>

                                {needsProfilesFolderFix ? (
                                    <>
                                        <p className="modal-note">{t('modal.diag.marker.profilesMissing')}</p>
                                        <div className="modal-actions">
                                            <button className="switch-btn secondary" onClick={closeDiagnosticsModal} disabled={isLoading}>
                                                {t('common.cancel')}
                                            </button>
                                            <button className="action-btn" onClick={() => void onEnsureProfilesFolder()} disabled={isLoading}>
                                                {t('modal.diag.marker.createProfilesFirst')}
                                            </button>
                                        </div>
                                    </>
                                ) : profiles.length === 0 ? (
                                    <>
                                        <p className="modal-note">{t('modal.diag.marker.noProfiles')}</p>
                                        <div className="modal-actions">
                                            <button className="switch-btn secondary" onClick={closeDiagnosticsModal} disabled={isLoading}>
                                                {t('common.close')}
                                            </button>
                                            <button className="action-btn" onClick={() => setDiagnosticsModal('firstSave')} disabled={isLoading}>
                                                {t('modal.diag.marker.saveCurrentFirst')}
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        {!activeProfile.trim() && (
                                            <p className="modal-note">{t('modal.diag.marker.noActiveDetected')}</p>
                                        )}
                                        <select
                                            value={markerDialogProfile}
                                            onChange={(event) => setMarkerDialogProfile(event.target.value)}
                                            disabled={isLoading}
                                            aria-label={t('modal.diag.marker.chooseActiveAria')}
                                        >
                                            {profiles.map((profile) => (
                                                <option key={profile.name} value={profile.name}>
                                                    {profile.name}
                                                </option>
                                            ))}
                                        </select>
                                        <p className="modal-note">{t('modal.diag.marker.selectedProfile', {name: markerDialogProfile || t('common.noneSelected')})}</p>
                                        <div className="modal-actions">
                                            <button className="switch-btn secondary" onClick={closeDiagnosticsModal} disabled={isLoading}>
                                                {t('common.cancel')}
                                            </button>
                                            {!activeProfile.trim() && (
                                                <button className="switch-btn secondary" onClick={() => setDiagnosticsModal('firstSave')} disabled={isLoading}>
                                                    {t('modal.diag.marker.saveCurrentFirst')}
                                                </button>
                                            )}
                                            <button className="action-btn" onClick={() => void onCreateMarkerFile(markerDialogProfile)} disabled={isLoading || !markerDialogProfile.trim()}>
                                                {t('modal.diag.marker.setActiveButton')}
                                            </button>
                                        </div>
                                    </>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}

            {isExportModalOpen && (
                <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="export-modal-title" aria-describedby="export-modal-description">
                    <div className="modal-card export-modal-card" onClick={(event) => event.stopPropagation()}>
                        <h3 id="export-modal-title">{t('modal.export.title')}</h3>
                        <p id="export-modal-description">{t('modal.export.description')}</p>
                        <label className="field-label" htmlFor="export-profile-modal-input">{t('modal.export.label')}</label>
                        <select
                            id="export-profile-modal-input"
                            value={exportProfileName}
                            onChange={(event) => setExportProfileName(event.target.value)}
                            disabled={isLoading}
                            autoFocus
                        >
                            {profiles.length === 0 ? (
                                <option value="">{t('modal.export.none')}</option>
                            ) : (
                                profiles.map((profile) => (
                                    <option key={profile.name} value={profile.name}>
                                        {profile.name}
                                    </option>
                                ))
                            )}
                        </select>
                        <div className="modal-actions">
                            <button className="switch-btn secondary" onClick={closeExportModal} disabled={isLoading}>
                                {t('common.cancel')}
                            </button>
                            <button className="action-btn" onClick={() => void onExportBundle()} disabled={isLoading || !canExportBundle}>
                                <Download size={14} strokeWidth={2.1} /> {t('modal.export.button')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isImportModalOpen && (
                <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="import-modal-title" aria-describedby="import-modal-description">
                    <div className="modal-card import-modal-card" onClick={(event) => event.stopPropagation()}>
                        <h3 id="import-modal-title">{t('modal.import.title')}</h3>
                        <p id="import-modal-description">{t('modal.import.description')}</p>
                        <div className="import-modal-section">
                            <label className="field-label" htmlFor="import-profile-modal-input">{t('modal.import.label')}</label>
                            <div className="import-modal-destination">
                                <select
                                    id="import-profile-modal-input"
                                    value={importTargetProfile}
                                    onChange={(event) => {
                                        const next = event.target.value;
                                        setImportTargetProfile(next);
                                        if (next !== NEW_PROFILE_OPTION) {
                                            setImportTargetNewName('');
                                        }
                                    }}
                                    disabled={isLoading}
                                >
                                    {profiles.map((profile) => (
                                        <option key={profile.name} value={profile.name}>
                                            {profile.name}
                                        </option>
                                    ))}
                                    <option value={NEW_PROFILE_OPTION}>{t('saveActions.createNewProfileOption')}</option>
                                </select>
                            </div>
                            {importTargetProfile === NEW_PROFILE_OPTION && (
                                <div className="import-modal-destination import-modal-new-profile-row">
                                    <input
                                        ref={importNewProfileRef}
                                        value={importTargetNewName}
                                        onChange={(event) => setImportTargetNewName(event.target.value)}
                                        placeholder={t('saveActions.newProfilePlaceholder')}
                                        disabled={isLoading}
                                    />
                                </div>
                            )}
                        </div>
                        <div className="import-modal-section import-modal-bundle-section">
                            <p className="field-label import-bundle-label">{t('modal.import.bundleLabel')}</p>
                            <div className="field-row import-bundle-row">
                                <div className={`import-bundle-display${importBundlePath.trim() ? '' : ' is-placeholder'}`} title={importBundlePath || t('common.noneSelectedBundle')}>
                                    {importBundlePath || t('common.noneSelectedBundle')}
                                </div>
                                <button className="switch-btn secondary" onClick={() => void onPickImportBundlePath()} disabled={isLoading}>
                                    {t('common.browse')}
                                </button>
                            </div>
                        </div>
                        <div className="modal-actions">
                            <button className="switch-btn secondary" onClick={closeImportModal} disabled={isLoading}>
                                {t('common.cancel')}
                            </button>
                            <button className="action-btn import-action" onClick={() => void onImportBundle()} disabled={isLoading || !canImportBundle}>
                                <Upload size={14} strokeWidth={2.1} /> {t('modal.import.button')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {renameTarget && (
                <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="rename-modal-title" aria-describedby="rename-modal-description">
                    <div className="modal-card" onClick={(event) => event.stopPropagation()}>
                        <h3 id="rename-modal-title">{t('modal.rename.title')}</h3>
                        <p id="rename-modal-description">{t('modal.rename.description', {name: renameTarget})}</p>
                        <input
                            value={renameValue}
                            onChange={(event) => setRenameValue(event.target.value)}
                            disabled={isLoading}
                            autoFocus
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    void confirmRenameProfile();
                                }
                            }}
                        />
                        <div className="modal-actions">
                            <button className="switch-btn secondary" onClick={closeRenameModal} disabled={isLoading}>
                                {t('common.cancel')}
                            </button>
                            <button className="action-btn" onClick={() => void confirmRenameProfile()} disabled={isLoading}>
                                {t('common.rename')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {deleteTarget && (
                <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title" aria-describedby="delete-modal-description">
                    <div className="modal-card danger delete-modal-card" onClick={(event) => event.stopPropagation()}>
                        <h3 id="delete-modal-title">{t('modal.delete.title')}</h3>
                        <p id="delete-modal-description">{t('modal.delete.description', {name: deleteTarget})}</p>
                        {deletableProfiles.length > 1 && (
                            <>
                                <label className="field-label" htmlFor="delete-profile-modal-select">{t('modal.delete.label')}</label>
                                <select
                                    id="delete-profile-modal-select"
                                    value={deleteTarget}
                                    onChange={(event) => setDeleteTarget(event.target.value)}
                                    disabled={isLoading}
                                >
                                    {deletableProfiles.map((profile) => (
                                        <option key={profile.name} value={profile.name}>
                                            {profile.name}
                                        </option>
                                    ))}
                                </select>
                            </>
                        )}
                        <div className="modal-actions">
                            <button className="switch-btn secondary" onClick={closeDeleteModal} disabled={isLoading}>
                                {t('common.cancel')}
                            </button>
                            <button className="switch-btn danger" onClick={() => void confirmDeleteProfile()} disabled={isLoading}>
                                {t('common.delete')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="app-version-chip" aria-label={t('aria.appVersion')}>
                v{(appVersion || updateInfo?.currentVersion || 'dev').replace(/^v/i, '')}
            </div>
        </div>
    );
}

export default App;
