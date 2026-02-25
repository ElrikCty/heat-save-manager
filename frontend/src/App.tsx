import {useEffect, useRef, useState} from 'react';
import {AlertTriangle, ArrowRightLeft, CheckCircle2, CircleX, Download, Edit3, FileText, Folder, FolderOpen, HardDrive, Plus, RefreshCw, Save, Trash2, Upload, Zap} from 'lucide-react';
import './App.css';
import {
    CreateMarkerFile,
    DeleteProfile,
    EnsureProfilesFolder,
    ExportProfileBundle,
    GetActiveProfile,
    GetPaths,
    ImportProfileBundle,
    ListProfiles,
    PickImportBundlePath,
    PrepareFreshProfile,
    RenameProfile,
    SaveCurrentProfile,
    SetSaveGamePath,
    SwitchProfile,
    RunHealthCheck,
} from '../wailsjs/go/main/App';

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

function toErrorFeedback(error: unknown, fallback: string): ErrorFeedback {
    const detail = normalizeError(error);
    const lowered = detail.toLowerCase();

    if (lowered.includes('cannot delete active profile')) {
        return {
            message: 'You cannot delete the active profile.',
            hint: 'Switch to a different profile, then delete this one.',
        };
    }

    if (lowered.includes('root savegame folder is missing') || lowered.includes('root wraps folder is missing')) {
        return {
            message: 'Current root save folders are missing.',
            hint: 'Open the game once to regenerate save folders, then try again.',
        };
    }

    if (lowered.includes('savegame path') || lowered.includes('path must point to the savegame folder')) {
        return {
            message: 'SaveGame path is invalid.',
            hint: 'Set the exact SaveGame directory path in the path panel.',
        };
    }

    if (lowered.includes('invalid characters') || lowered.includes('profile name is required')) {
        return {
            message: 'Profile name is invalid.',
            hint: 'Use letters/numbers and avoid Windows invalid filename characters.',
        };
    }

    if (lowered.includes('already exists')) {
        return {
            message: 'That profile name already exists.',
            hint: 'Pick another name or rename the existing profile first.',
        };
    }

    if (lowered.includes('profile not found')) {
        return {
            message: 'Selected profile no longer exists.',
            hint: 'Refresh profiles and try again.',
        };
    }

    if (lowered.includes('access is denied') || lowered.includes('being used by another process')) {
        return {
            message: 'Files are currently locked by another process.',
            hint: 'Close the game and any tools touching save files, then retry.',
        };
    }

    if (lowered.includes('bundle contains invalid file path')) {
        return {
            message: 'Bundle file is unsafe or malformed.',
            hint: 'Use a bundle exported by this app and try again.',
        };
    }

    if (lowered.includes('invalid profile layout')) {
        return {
            message: 'Profile bundle is missing required folders.',
            hint: 'Bundle must include both savegame and wraps folders.',
        };
    }

    return {
        message: `${fallback}: ${detail}`,
        hint: '',
    };
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

function App() {
    const [saveGamePath, setSaveGamePath] = useState('');
    const [saveGamePathInput, setSaveGamePathInput] = useState('');
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [activeProfile, setActiveProfile] = useState('');
    const [freshProfileName, setFreshProfileName] = useState('');
    const [saveDestinationMode, setSaveDestinationMode] = useState<'active' | 'custom'>('active');
    const [saveDestinationProfile, setSaveDestinationProfile] = useState('');
    const [saveDestinationNewName, setSaveDestinationNewName] = useState('');
    const [exportProfileName, setExportProfileName] = useState('');
    const [importTargetProfile, setImportTargetProfile] = useState('');
    const [importTargetNewName, setImportTargetNewName] = useState('');
    const [importBundlePath, setImportBundlePath] = useState('');
    const [status, setStatus] = useState('Loading profiles...');
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
    const [isBundleExpanded, setIsBundleExpanded] = useState(false);
    const [selectedProfileName, setSelectedProfileName] = useState('');
    const [toastMessage, setToastMessage] = useState('');
    const saveActionsRef = useRef<HTMLDivElement | null>(null);
    const importNewProfileRef = useRef<HTMLInputElement | null>(null);
    const toastTimerRef = useRef<number | null>(null);

    const isModalOpen = renameTarget !== null || deleteTarget !== null || diagnosticsModal !== null || isExportModalOpen || isImportModalOpen;

    const canApplyPath = saveGamePathInput.trim() !== '';
    const canPrepareFresh = freshProfileName.trim() !== '';
    const canExportBundle = exportProfileName.trim() !== '';
    const resolvedImportTarget = importTargetProfile === NEW_PROFILE_OPTION ? importTargetNewName.trim() : importTargetProfile.trim();
    const canImportBundle = resolvedImportTarget !== '' && importBundlePath.trim() !== '';
    const canSwitchSelected = selectedProfileName.trim() !== '' && selectedProfileName !== activeProfile;
    const markerHealthItem = healthReport?.items.find((item) => item.name === 'marker_file') ?? null;
    const needsProfilesFolderFix = healthReport?.items.some((item) => item.name === 'profiles_path' && !item.ok) ?? false;
    const needsMarkerFileFix = markerHealthItem?.message.toLowerCase().includes('is missing') ?? false;
    const hasDiagnosticErrors = healthReport?.items.some((item) => item.severity === 'error') ?? false;
    const hasDiagnosticWarnings = healthReport?.items.some((item) => item.severity === 'warn') ?? false;
    const diagnosticsStatusLabel = !healthReport
        ? 'Not run yet'
        : hasDiagnosticErrors
            ? 'Needs attention'
            : hasDiagnosticWarnings
                ? 'Ready with warnings'
                : 'Ready';
    const diagnosticsStatusClass = !healthReport
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

    async function loadData() {
        try {
            setIsLoading(true);
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

            let resolvedActive = '';
            try {
                const active = await GetActiveProfile();
                resolvedActive = active;
                setActiveProfile(active);
            } catch {
                setActiveProfile('');
            }

            setSelectedProfileName((current) => {
                if (resolvedActive && profileItems.some((profile) => profile.name === resolvedActive)) {
                    return resolvedActive;
                }

                if (current && profileItems.some((profile) => profile.name === current)) {
                    return current;
                }

                return profileItems[0]?.name ?? '';
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

                return current;
            });

            setExportProfileName((current) => {
                if (current && profileItems.some((profile) => profile.name === current)) {
                    return current;
                }

                return profileItems[0]?.name ?? '';
            });

            setImportTargetProfile((current) => {
                if (current === NEW_PROFILE_OPTION) {
                    return NEW_PROFILE_OPTION;
                }

                if (current && profileItems.some((profile) => profile.name === current)) {
                    return current;
                }

                return profileItems[0]?.name ?? NEW_PROFILE_OPTION;
            });

            setStatus('Ready');
            setRecoveryHint('');
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Failed to load profiles');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    async function onRunHealthCheck() {
        try {
            setIsLoading(true);
            setStatus('Running diagnostics...');
            setRecoveryHint('');
            const report = await RunHealthCheck();
            setHealthReport(report);
            const hasErrors = report.items.some((item) => item.severity === 'error');
            const hasWarnings = report.items.some((item) => item.severity === 'warn');
            if (hasErrors) {
                setStatus('Diagnostics complete: action needed.');
            } else if (hasWarnings) {
                setStatus('Diagnostics complete: ready with warnings.');
            } else {
                setStatus('Diagnostics complete: setup looks ready.');
            }
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Diagnostics failed');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    async function onApplyPath() {
        const trimmed = saveGamePathInput.trim();
        if (!trimmed) {
            setStatus('SaveGame path cannot be empty.');
            return;
        }

        const normalized = trimmed.replace(/[\\/]+$/, '');
        if (!/[\\/]SaveGame$/i.test(normalized)) {
            setStatus('Path must point directly to the SaveGame folder.');
            return;
        }

        try {
            setIsLoading(true);
            setStatus('Applying SaveGame path...');
            setRecoveryHint('');
            await SetSaveGamePath(trimmed);
            await loadData();
            setStatus('SaveGame path updated and refreshed.');
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Path update failed');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    async function onEnsureProfilesFolder(closeModalAfter = false) {
        try {
            setIsLoading(true);
            setStatus('Creating Profiles folder...');
            setRecoveryHint('');
            await EnsureProfilesFolder();
            await loadData();
            setStatus('Profiles folder is ready.');
            if (closeModalAfter) {
                setDiagnosticsModal(null);
            }
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Failed to create Profiles folder');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    async function onCreateMarkerFile(profileName?: string) {
        const selectedProfile = (profileName ?? markerDialogProfile).trim();
        if (!selectedProfile) {
            setStatus('Select a profile first to create active_profile.txt.');
            return;
        }

        try {
            setIsLoading(true);
            setStatus(`Creating marker for ${selectedProfile}...`);
            setRecoveryHint('');
            await CreateMarkerFile(selectedProfile);
            setActiveProfile(selectedProfile);
            await loadData();
            setStatus(`active_profile.txt created for ${selectedProfile}.`);
            setDiagnosticsModal(null);
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Failed to create marker file');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    async function onSwitch(profileName: string) {
        try {
            setStatus(`Switching to ${profileName}...`);
            setIsLoading(true);
            setRecoveryHint('');
            await SwitchProfile(profileName);
            setActiveProfile(profileName);
            setSelectedProfileName(profileName);
            setStatus(`Active profile: ${profileName}`);
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Switch failed');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    async function onSwitchSelectedProfile() {
        const profileName = selectedProfileName.trim();
        if (!profileName || profileName === activeProfile) {
            return;
        }

        await onSwitch(profileName);
    }

    async function onPrepareFresh() {
        const name = freshProfileName.trim();
        if (!name) {
            setStatus('Choose a profile name before preparing a fresh save.');
            return;
        }

        try {
            setIsLoading(true);
            setStatus(`Preparing fresh profile ${name}...`);
            setRecoveryHint('');
            await PrepareFreshProfile(name);
            setFreshProfileName('');
            setActiveProfile(name);
            await loadData();
            setStatus(`Fresh profile prepared: ${name}. Start the game to generate a new save.`);
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Fresh profile prep failed');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    async function onSaveCurrent() {
        if (!canSaveCurrent) {
            if (saveDestinationMode === 'active') {
                setStatus('No active profile marker found. Choose another destination first.');
            } else {
                setStatus('Choose or enter a destination profile first.');
            }
            return;
        }

        const target = resolvedSaveDestination;
        const requested = saveDestinationMode === 'active' ? '' : target;
        const shouldAutoSetActive = !activeProfile.trim() && needsMarkerFileFix && profiles.length === 0 && requested !== '';

        try {
            setIsLoading(true);
            setStatus(`Saving current root data into ${target}...`);
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
            setStatus(shouldAutoSetActive ? `Current root save exported to ${target} and set as active profile.` : `Current root save exported to ${target}.`);
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Save current failed');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    async function onExportBundle() {
        const profileName = exportProfileName.trim();
        if (!profileName) {
            setStatus('Choose a profile to export first.');
            return;
        }

        const bundlePath = buildExportBundlePath(saveGamePath, profileName);

        try {
            setIsLoading(true);
            setStatus(`Exporting ${profileName} bundle...`);
            setRecoveryHint('');
            await ExportProfileBundle(profileName, bundlePath);
            setStatus(`Bundle exported: ${bundlePath}`);
            setToastMessage(`Exported bundle for ${profileName}.`);
            setIsExportModalOpen(false);
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Bundle export failed');
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
            setStatus(importTargetProfile === NEW_PROFILE_OPTION ? 'Enter a new profile name for import.' : 'Choose destination profile first.');
            return;
        }

        if (!bundlePath) {
            setStatus('Browse and choose a .zip bundle to import first.');
            return;
        }

        try {
            setIsLoading(true);
            setStatus(`Importing bundle into ${profileName}...`);
            setRecoveryHint('');
            await ImportProfileBundle(profileName, bundlePath);
            await loadData();
            setStatus(`Bundle imported into profile ${profileName}.`);
            setToastMessage(`Imported bundle into ${profileName}.`);
            setIsImportModalOpen(false);
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Bundle import failed');
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
            const feedback = toErrorFeedback(error, 'Failed to open file picker');
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
            setStatus(`Renaming ${renameTarget} to ${nextName}...`);
            setRecoveryHint('');
            await RenameProfile(renameTarget, nextName);
            await loadData();
            setStatus(`Profile renamed to ${nextName}.`);
            closeRenameModal();
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Rename failed');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    function openDeleteModal(profileName: string) {
        setDeleteTarget(profileName);
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
    }

    function openExportModal() {
        setIsExportModalOpen(true);
    }

    function closeExportModal() {
        setIsExportModalOpen(false);
    }

    function openImportModal() {
        setIsImportModalOpen(true);
    }

    function closeImportModal() {
        setIsImportModalOpen(false);
    }

    async function onSaveCurrentFromModal() {
        const profileName = firstSaveProfileName.trim();
        if (!profileName) {
            setStatus('Enter a profile name before saving current progress.');
            return;
        }

        try {
            setIsLoading(true);
            setStatus(`Saving current root data into ${profileName}...`);
            setRecoveryHint('');
            await SaveCurrentProfile(profileName);

            if (!activeProfile.trim() && needsMarkerFileFix && profiles.length === 0) {
                await CreateMarkerFile(profileName);
                setActiveProfile(profileName);
            }

            await loadData();
            setDiagnosticsModal(null);
            setFirstSaveProfileName('');
            setStatus(`Current root save exported to ${profileName} and set as active profile.`);
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Save current failed');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    function closeActiveModal() {
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
            setStatus(`Deleting ${deleteTarget}...`);
            setRecoveryHint('');
            await DeleteProfile(deleteTarget);
            await loadData();
            setStatus(`Profile deleted: ${deleteTarget}.`);
            closeDeleteModal();
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Delete failed');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    useEffect(() => {
        void loadData();
    }, []);

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
    }, [isModalOpen, isLoading, renameTarget, deleteTarget, diagnosticsModal, isExportModalOpen, isImportModalOpen]);

    useEffect(() => {
        if (importTargetProfile === NEW_PROFILE_OPTION) {
            importNewProfileRef.current?.focus();
        }
    }, [importTargetProfile]);

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
        }, 3200);

        return () => {
            if (toastTimerRef.current !== null) {
                window.clearTimeout(toastTimerRef.current);
                toastTimerRef.current = null;
            }
        };
    }, [toastMessage]);

    return (
        <div className="app-shell">
            <header className="hero">
                <p className="eyebrow"><Zap size={11} strokeWidth={2.3} /> Need for Speed Heat</p>
                <h1>Heat Save Manager</h1>
                <div className="hero-actions">
                    <p className="current-profile">Current Profile: <strong>{activeProfile || 'None selected'}</strong></p>
                    <button className="top-refresh-btn" onClick={() => void loadData()} disabled={isLoading || isModalOpen}>
                        <RefreshCw size={13} strokeWidth={2.2} className={isLoading ? 'spin' : ''} /> Refresh
                    </button>
                </div>
                <p className={`status ${diagnosticsStatusClass}`}><span className="status-dot" aria-hidden="true" /> {diagnosticsStatusLabel}</p>
                {status.trim().toLowerCase() !== 'ready' && <p className="status-hint">{status}</p>}
                {recoveryHint && <p className="status-hint">Tip: {recoveryHint}</p>}
            </header>

            <main className="dashboard workspace-layout">
                <section className="panel diagnostics-panel side-panel">
                    <div className="panel-header-row diag-header">
                        <h2>Diagnostics</h2>
                        <span className={`diag-pill ${diagnosticsStatusClass}`}>
                            <span className="diag-pill-dot" aria-hidden="true" />
                            {diagnosticsStatusLabel}
                        </span>
                    </div>
                    <p className="diag-last-run">Last run: {healthReport?.checkedAt ? new Date(healthReport.checkedAt).toLocaleString() : 'Not run yet'}</p>
                    <button className="diag-run-btn" onClick={() => void onRunHealthCheck()} disabled={isLoading || isModalOpen}>
                        <span className="diag-run-glow" aria-hidden="true" />
                        <span className="diag-run-label">
                            {isLoading ? 'Running...' : (<><Zap size={13} strokeWidth={2.15} /> Run Diagnostics</>)}
                        </span>
                    </button>
                    {(needsProfilesFolderFix || needsMarkerFileFix) && (
                        <div className="diag-actions">
                            <h3>Quick Actions</h3>
                            <p className="diag-callout">Action required: use a quick action below to continue setup.</p>
                            {needsProfilesFolderFix && (
                                <button className="action-btn secondary attention" onClick={() => openDiagnosticsModal('profiles')} disabled={isLoading || isModalOpen}>
                                    Create Profiles folder
                                </button>
                            )}
                            {needsMarkerFileFix && (
                                <button className="action-btn secondary attention" onClick={() => openDiagnosticsModal('marker')} disabled={isLoading || isModalOpen}>
                                    Set active profile
                                </button>
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
                                        <strong>{item.name.replaceAll('_', ' ')}</strong>
                                    </div>
                                    <span className="health-message">{item.message}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                <div className="primary-stack">
                <section className="panel profile-section-card">
                    <div className="panel-block">
                        <div className="panel-header-row">
                            <h2>Profiles</h2>
                            <span className="field-hint">Active: <strong>{activeProfile || 'None selected'}</strong></span>
                        </div>

                        {profiles.length > 0 ? (
                            <div className="profile-toolbar">
                                <div className="profile-select-wrap">
                                    <select
                                        className={selectedProfileName === activeProfile ? 'has-active-tag' : ''}
                                        value={selectedProfileName}
                                        onChange={(event) => setSelectedProfileName(event.target.value)}
                                        disabled={isLoading || isModalOpen}
                                        aria-label="Select profile"
                                    >
                                        {profiles.map((profile) => (
                                            <option key={profile.name} value={profile.name}>
                                                {profile.name}
                                            </option>
                                        ))}
                                    </select>
                                    {selectedProfileName === activeProfile && <span className="profile-active-tag">ACTIVE</span>}
                                </div>
                                <button className="switch-btn" onClick={() => void onSwitchSelectedProfile()} disabled={isLoading || isModalOpen || !canSwitchSelected}>
                                    <ArrowRightLeft size={13} strokeWidth={2.1} />
                                    Switch
                                </button>
                                <button
                                    className="switch-btn secondary"
                                    onClick={() => openRenameModal(selectedProfileName)}
                                    disabled={isLoading || isModalOpen || !selectedProfileName}
                                    aria-label="Rename selected profile"
                                >
                                    <Edit3 size={13} strokeWidth={2.1} />
                                    Rename
                                </button>
                                <button
                                    className="switch-btn danger"
                                    onClick={() => openDeleteModal(selectedProfileName)}
                                    disabled={isLoading || isModalOpen || !selectedProfileName || selectedProfileName === activeProfile}
                                    aria-label="Delete selected profile"
                                >
                                    <Trash2 size={13} strokeWidth={2.1} />
                                    Delete
                                </button>
                            </div>
                        ) : (
                            <div>
                                <p className="empty">No profiles found in the Profiles folder.</p>
                                <p className="field-hint">Create one with Start New Save to begin.</p>
                            </div>
                        )}
                    </div>

                </section>

                <section className="panel save-actions-panel" ref={saveActionsRef}>
                    <h2>Save Actions</h2>
                    <div className="save-actions-grid">
                        <div className="setup-group save-card start-save-card">
                            <div className="save-card-head">
                                <span className="save-card-icon" aria-hidden="true"><Plus size={14} strokeWidth={2.2} /></span>
                                <label className="field-label" htmlFor="fresh-profile-input">Start New Save</label>
                            </div>
                            <div className="field-row">
                                <input
                                    id="fresh-profile-input"
                                    value={freshProfileName}
                                    onChange={(event) => setFreshProfileName(event.target.value)}
                                    placeholder="New profile name"
                                    disabled={isLoading || isModalOpen}
                                />
                                <button className="action-btn" onClick={() => void onPrepareFresh()} disabled={isLoading || isModalOpen || !canPrepareFresh}>
                                    <Plus size={14} strokeWidth={2.2} /> Start New Save
                                </button>
                            </div>
                        </div>

                        <div className="setup-group save-current-group save-card save-progress-card">
                            <div className="save-card-head">
                                <span className="save-card-icon" aria-hidden="true"><Save size={13} strokeWidth={2.2} /></span>
                                <label className="field-label" htmlFor="save-profile-input">Save Current Progress</label>
                            </div>
                            <div className="save-mode-row" role="radiogroup" aria-label="Save current destination mode">
                                <label className="save-mode-option">
                                    <input
                                        type="radio"
                                        checked={saveDestinationMode === 'active'}
                                        onChange={() => setSaveDestinationMode('active')}
                                        disabled={isLoading || isModalOpen || !hasActiveDestination}
                                    />
                                    <span className={!hasActiveDestination ? 'disabled-option' : ''}>{hasActiveDestination ? `Use active (${activeProfile})` : 'Use active (not available)'}</span>
                                </label>
                                <label className="save-mode-option">
                                    <input
                                        type="radio"
                                        checked={saveDestinationMode === 'custom'}
                                        onChange={() => setSaveDestinationMode('custom')}
                                        disabled={isLoading || isModalOpen}
                                    />
                                    <span>Choose destination</span>
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
                                                {profile.name}{profile.name === activeProfile ? ' (active)' : ''}
                                            </option>
                                        ))}
                                        <option value={NEW_PROFILE_OPTION}>Create new profile...</option>
                                    </select>
                                    {saveDestinationProfile === NEW_PROFILE_OPTION && (
                                        <input
                                            value={saveDestinationNewName}
                                            onChange={(event) => setSaveDestinationNewName(event.target.value)}
                                            placeholder="New profile name"
                                            disabled={isLoading || isModalOpen}
                                        />
                                    )}
                                </div>
                            )}

                            <p className="field-hint">
                                Destination: <strong>{resolvedSaveDestination || 'Not selected'}</strong>. This copies current <span className="path-token">savegame</span> + <span className="path-token">wraps</span> into that profile.
                            </p>
                            {!hasActiveDestination && saveDestinationMode === 'active' && (
                                <p className="field-hint">No active marker detected yet. Use "Choose destination" or create `active_profile.txt` from Diagnostics.</p>
                            )}
                            <div className="field-row">
                                <button className="action-btn secondary" onClick={() => void onSaveCurrent()} disabled={isLoading || isModalOpen || !canSaveCurrent}>
                                    <Save size={15} strokeWidth={2.2} /> Save Progress
                                </button>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="panel save-setup-panel">
                    <h2>Save Setup</h2>
                    <div className="setup-group save-setup-inner-card">
                        <label className="field-label savegame-path-label" htmlFor="savegame-path-input">
                            <FolderOpen size={13} strokeWidth={2} />
                            <span>SaveGame Path</span>
                        </label>
                        <p className="path">{saveGamePath ? maskWindowsUserPath(saveGamePath) : 'Not set'}</p>
                        <div className="field-row">
                            <input
                                id="savegame-path-input"
                                value={saveGamePathInput}
                                onChange={(event) => setSaveGamePathInput(event.target.value)}
                                placeholder="C:\\Users\\<user>\\Documents\\Need for speed heat\\SaveGame"
                                disabled={isLoading || isModalOpen}
                            />
                            <button className="action-btn secondary" onClick={() => void onApplyPath()} disabled={isLoading || isModalOpen || !canApplyPath}>
                                Apply Path
                            </button>
                        </div>
                        <p className="field-hint">Path must point directly to the <span className="path-token">SaveGame</span> folder.</p>
                    </div>
                </section>

                <section className="panel advanced-panel">
                    <div className="bundle-header-row">
                        <div>
                            <h2>Advanced</h2>
                            <p className="field-hint">Bundle Transfer tools for manually moving profiles between machines or backups.</p>
                        </div>
                        <button
                            className="switch-btn secondary"
                            onClick={() => setIsBundleExpanded((open) => !open)}
                            disabled={isLoading || isModalOpen}
                            aria-expanded={isBundleExpanded}
                            aria-controls="bundle-transfer-content"
                        >
                            {isBundleExpanded ? 'Hide' : 'Show'}
                        </button>
                    </div>

                    {isBundleExpanded && (
                        <div id="bundle-transfer-content" className="bundle-content">
                            <div className="advanced-cards-grid">
                                <div className="advanced-tool-card export-tool-card">
                                    <div className="advanced-tool-head">
                                        <span className="advanced-tool-icon" aria-hidden="true"><Download size={14} strokeWidth={2.1} /></span>
                                        <h3>Export Profile</h3>
                                    </div>
                                    <p className="advanced-tool-copy">Export to a .zip bundle for backup or transfer to another machine.</p>
                                    {profiles.length === 0 && <p className="field-hint">Create or save a profile first, then export it.</p>}
                                    <button className="action-btn advanced-tool-action export-action" onClick={openExportModal} disabled={isLoading || isModalOpen || profiles.length === 0}>
                                        <Download size={14} strokeWidth={2.1} /> Export Bundle
                                    </button>
                                </div>

                                <div className="advanced-tool-card import-tool-card">
                                    <div className="advanced-tool-head">
                                        <span className="advanced-tool-icon" aria-hidden="true"><Upload size={14} strokeWidth={2.1} /></span>
                                        <h3>Import Profile</h3>
                                    </div>
                                    <p className="advanced-tool-copy">Import a profile bundle from another machine or backup.</p>
                                    <button className="action-btn secondary advanced-tool-action import-action" onClick={openImportModal} disabled={isLoading || isModalOpen}>
                                        <Upload size={14} strokeWidth={2.1} /> Import Bundle
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </section>
                </div>
            </main>
            <footer className="footnote">
                <p>Marker file: active_profile.txt</p>
            </footer>

            {toastMessage && (
                <div className="toast toast-success" role="status" aria-live="polite">
                    <CheckCircle2 size={15} strokeWidth={2.2} /> {toastMessage}
                </div>
            )}

            {diagnosticsModal && (
                <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="diag-modal-title" aria-describedby="diag-modal-description">
                    <div className="modal-card" onClick={(event) => event.stopPropagation()}>
                        {diagnosticsModal === 'profiles' ? (
                            <>
                                <h3 id="diag-modal-title">Create Profiles Folder</h3>
                                <p id="diag-modal-description">
                                    Diagnostics found that `SaveGame/Profiles` is missing. This action creates the folder so profile operations can work normally.
                                </p>
                                <div className="modal-actions">
                                    <button className="switch-btn secondary" onClick={closeDiagnosticsModal} disabled={isLoading}>
                                        Cancel
                                    </button>
                                    <button className="action-btn" onClick={() => void onEnsureProfilesFolder(true)} disabled={isLoading}>
                                        Create Profiles folder
                                    </button>
                                </div>
                            </>
                        ) : diagnosticsModal === 'firstSave' ? (
                            <>
                                <h3 id="diag-modal-title">Save Current Progress First</h3>
                                <p id="diag-modal-description">
                                    Create your first profile from the current game state. This will also set it as active.
                                </p>
                                <input
                                    value={firstSaveProfileName}
                                    onChange={(event) => setFirstSaveProfileName(event.target.value)}
                                    placeholder="New profile name"
                                    disabled={isLoading}
                                    autoFocus
                                />
                                <div className="modal-actions">
                                    <button className="switch-btn secondary" onClick={closeDiagnosticsModal} disabled={isLoading}>
                                        Cancel
                                    </button>
                                    <button className="action-btn" onClick={() => void onSaveCurrentFromModal()} disabled={isLoading || !firstSaveProfileName.trim()}>
                                        Save Current Progress
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <h3 id="diag-modal-title">Set Active Profile</h3>
                                <p id="diag-modal-description">
                                    This creates `active_profile.txt` and marks which profile should be considered active for save operations.
                                </p>

                                {needsProfilesFolderFix ? (
                                    <>
                                        <p className="modal-note">Profiles folder is missing first. Create it, then choose an active profile.</p>
                                        <div className="modal-actions">
                                            <button className="switch-btn secondary" onClick={closeDiagnosticsModal} disabled={isLoading}>
                                                Cancel
                                            </button>
                                            <button className="action-btn" onClick={() => void onEnsureProfilesFolder()} disabled={isLoading}>
                                                Create Profiles folder first
                                            </button>
                                        </div>
                                    </>
                                ) : profiles.length === 0 ? (
                                    <>
                                        <p className="modal-note">No profiles exist yet. Create one using Start New Save or Save Current Progress first.</p>
                                        <div className="modal-actions">
                                            <button className="action-btn" onClick={() => setDiagnosticsModal('firstSave')} disabled={isLoading}>
                                                Save Current Progress first
                                            </button>
                                            <button className="switch-btn secondary" onClick={closeDiagnosticsModal} disabled={isLoading}>
                                                Close
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <select
                                            value={markerDialogProfile}
                                            onChange={(event) => setMarkerDialogProfile(event.target.value)}
                                            disabled={isLoading}
                                            aria-label="Choose active profile"
                                        >
                                            {profiles.map((profile) => (
                                                <option key={profile.name} value={profile.name}>
                                                    {profile.name}
                                                </option>
                                            ))}
                                        </select>
                                        <p className="modal-note">Selected profile: <strong>{markerDialogProfile || 'None selected'}</strong></p>
                                        <div className="modal-actions">
                                            <button className="switch-btn secondary" onClick={closeDiagnosticsModal} disabled={isLoading}>
                                                Cancel
                                            </button>
                                            <button className="action-btn" onClick={() => void onCreateMarkerFile(markerDialogProfile)} disabled={isLoading || !markerDialogProfile.trim()}>
                                                Set active profile
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
                        <h3 id="export-modal-title">Export Profile Bundle</h3>
                        <p id="export-modal-description">Choose which profile to export. The bundle will be created in <span className="path-token">SaveGame/Exports</span>.</p>
                        <label className="field-label" htmlFor="export-profile-modal-input">Profile to export</label>
                        <select
                            id="export-profile-modal-input"
                            value={exportProfileName}
                            onChange={(event) => setExportProfileName(event.target.value)}
                            disabled={isLoading}
                            autoFocus
                        >
                            {profiles.length === 0 ? (
                                <option value="">No profiles available</option>
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
                                Cancel
                            </button>
                            <button className="action-btn" onClick={() => void onExportBundle()} disabled={isLoading || !canExportBundle}>
                                <Download size={14} strokeWidth={2.1} /> Export Bundle
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isImportModalOpen && (
                <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="import-modal-title" aria-describedby="import-modal-description">
                    <div className="modal-card import-modal-card" onClick={(event) => event.stopPropagation()}>
                        <h3 id="import-modal-title">Import Profile Bundle</h3>
                        <p id="import-modal-description">Choose destination profile and bundle file to import.</p>
                        <label className="field-label" htmlFor="import-profile-modal-input">Import .zip into profile</label>
                        <div className="field-row import-modal-row">
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
                                <option value={NEW_PROFILE_OPTION}>Create new profile...</option>
                            </select>
                            <button className="switch-btn secondary" onClick={() => void onPickImportBundlePath()} disabled={isLoading}>
                                Browse...
                            </button>
                        </div>
                        {importTargetProfile === NEW_PROFILE_OPTION && (
                            <div className="field-row">
                                <input
                                    ref={importNewProfileRef}
                                    value={importTargetNewName}
                                    onChange={(event) => setImportTargetNewName(event.target.value)}
                                    placeholder="New profile name"
                                    disabled={isLoading}
                                />
                            </div>
                        )}
                        <p className="field-hint import-modal-selected">Selected bundle: <strong>{importBundlePath || 'None selected'}</strong></p>
                        <div className="modal-actions">
                            <button className="switch-btn secondary" onClick={closeImportModal} disabled={isLoading}>
                                Cancel
                            </button>
                            <button className="action-btn secondary import-action" onClick={() => void onImportBundle()} disabled={isLoading || !canImportBundle}>
                                <Upload size={14} strokeWidth={2.1} /> Import Bundle
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {renameTarget && (
                <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="rename-modal-title" aria-describedby="rename-modal-description">
                    <div className="modal-card" onClick={(event) => event.stopPropagation()}>
                        <h3 id="rename-modal-title">Rename Profile</h3>
                        <p id="rename-modal-description">Choose a new name for <strong>{renameTarget}</strong>.</p>
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
                                Cancel
                            </button>
                            <button className="action-btn" onClick={() => void confirmRenameProfile()} disabled={isLoading}>
                                Rename
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {deleteTarget && (
                <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title" aria-describedby="delete-modal-description">
                    <div className="modal-card danger" onClick={(event) => event.stopPropagation()}>
                        <h3 id="delete-modal-title">Delete Profile</h3>
                        <p id="delete-modal-description">Delete <strong>{deleteTarget}</strong>? This action cannot be undone.</p>
                        <div className="modal-actions">
                            <button className="switch-btn secondary" onClick={closeDeleteModal} disabled={isLoading}>
                                Cancel
                            </button>
                            <button className="switch-btn danger" onClick={() => void confirmDeleteProfile()} disabled={isLoading}>
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;
