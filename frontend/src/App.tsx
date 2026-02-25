import {useEffect, useRef, useState} from 'react';
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
    PickExportBundlePath,
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
    const [exportBundlePath, setExportBundlePath] = useState('');
    const [importProfileName, setImportProfileName] = useState('');
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
    const [firstSaveProfileName, setFirstSaveProfileName] = useState('');
    const [isBundleExpanded, setIsBundleExpanded] = useState(false);
    const [selectedProfileName, setSelectedProfileName] = useState('');
    const saveActionsRef = useRef<HTMLDivElement | null>(null);

    const isModalOpen = renameTarget !== null || deleteTarget !== null || diagnosticsModal !== null;

    const loweredStatus = status.toLowerCase();
    const statusTone = loweredStatus.includes('failed') || loweredStatus.includes('invalid') || loweredStatus.includes('cannot')
        ? 'danger'
        : isLoading
            ? 'loading'
            : 'ok';

    const canApplyPath = saveGamePathInput.trim() !== '';
    const canPrepareFresh = freshProfileName.trim() !== '';
    const canExportBundle = exportProfileName.trim() !== '' && exportBundlePath.trim() !== '';
    const canImportBundle = importProfileName.trim() !== '' && importBundlePath.trim() !== '';
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
        const bundlePath = exportBundlePath.trim();
        if (!profileName || !bundlePath) {
            setStatus('Enter profile name and destination bundle path to export.');
            return;
        }

        try {
            setIsLoading(true);
            setStatus(`Exporting ${profileName} bundle...`);
            setRecoveryHint('');
            await ExportProfileBundle(profileName, bundlePath);
            setStatus(`Bundle exported: ${bundlePath}`);
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Bundle export failed');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    async function onImportBundle() {
        const profileName = importProfileName.trim();
        const bundlePath = importBundlePath.trim();
        if (!profileName || !bundlePath) {
            setStatus('Enter profile name and source bundle path to import.');
            return;
        }

        try {
            setIsLoading(true);
            setStatus(`Importing bundle into ${profileName}...`);
            setRecoveryHint('');
            await ImportProfileBundle(profileName, bundlePath);
            await loadData();
            setStatus(`Bundle imported into profile ${profileName}.`);
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Bundle import failed');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    async function onPickExportBundlePath() {
        try {
            const selected = await PickExportBundlePath();
            if (selected) {
                setExportBundlePath(selected);
            }
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Failed to open save dialog');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
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
    }, [isModalOpen, isLoading, renameTarget, deleteTarget, diagnosticsModal]);

    return (
        <div className="app-shell">
            <header className="hero">
                <p className="eyebrow">Need for Speed Heat</p>
                <h1>Heat Save Manager</h1>
                <p className="current-profile">Current Profile: <strong>{activeProfile || 'None selected'}</strong></p>
                <button className="top-refresh-btn" onClick={() => void loadData()} disabled={isLoading || isModalOpen}>
                    ↻ Refresh
                </button>
                <p className={`status ${statusTone}`}>{status}</p>
                {recoveryHint && <p className="status-hint">Tip: {recoveryHint}</p>}
            </header>

            <main className="dashboard workspace-layout">
                <section className="panel diagnostics-panel side-panel">
                    <h2>Diagnostics</h2>
                    <div className="diagnostics-summary">
                        <p>
                            Status:{' '}
                            <span className={diagnosticsStatusClass}>
                                {diagnosticsStatusLabel}
                            </span>
                        </p>
                        <p>Last run: {healthReport?.checkedAt ? new Date(healthReport.checkedAt).toLocaleString() : 'Not run yet'}</p>
                    </div>
                    <button className="refresh-btn" onClick={() => void onRunHealthCheck()} disabled={isLoading || isModalOpen}>
                        {isLoading ? 'Running...' : 'Run Diagnostics'}
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
                                    {item.severity === 'warn' ? (
                                        <span className="health-icon triangle" aria-hidden="true" />
                                    ) : (
                                        <span className="health-icon circle" aria-hidden="true">
                                            {item.severity === 'ok' ? '✓' : '✕'}
                                        </span>
                                    )}
                                    <strong>{item.name.replaceAll('_', ' ')}</strong>
                                    <span className="health-message">{item.message}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                <section className="panel primary-panel">
                    <div className="panel-block">
                        <div className="panel-header-row">
                            <h2>Profiles</h2>
                            <span className="field-hint">Active: {activeProfile || 'None selected'}</span>
                        </div>

                        {profiles.length > 0 ? (
                            <div className="profile-picker-row">
                                <select
                                    value={selectedProfileName}
                                    onChange={(event) => setSelectedProfileName(event.target.value)}
                                    disabled={isLoading || isModalOpen}
                                    aria-label="Select profile"
                                >
                                    {profiles.map((profile) => (
                                        <option key={profile.name} value={profile.name}>
                                            {profile.name}{profile.name === activeProfile ? ' (active)' : ''}
                                        </option>
                                    ))}
                                </select>
                                <button className="switch-btn" onClick={() => void onSwitchSelectedProfile()} disabled={isLoading || isModalOpen || !canSwitchSelected}>
                                    Switch
                                </button>
                                <button
                                    className="switch-btn secondary"
                                    onClick={() => openRenameModal(selectedProfileName)}
                                    disabled={isLoading || isModalOpen || !selectedProfileName}
                                    aria-label="Rename selected profile"
                                >
                                    Rename
                                </button>
                                <button
                                    className="switch-btn danger"
                                    onClick={() => openDeleteModal(selectedProfileName)}
                                    disabled={isLoading || isModalOpen || !selectedProfileName || selectedProfileName === activeProfile}
                                    aria-label="Delete selected profile"
                                >
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

                    <div className="panel-block" ref={saveActionsRef}>
                        <h2>Save Actions</h2>
                        <div className="setup-group">
                            <label className="field-label" htmlFor="fresh-profile-input">Start New Save</label>
                            <div className="field-row">
                                <input
                                    id="fresh-profile-input"
                                    value={freshProfileName}
                                    onChange={(event) => setFreshProfileName(event.target.value)}
                                    placeholder="New profile name"
                                    disabled={isLoading || isModalOpen}
                                />
                                <button className="action-btn" onClick={() => void onPrepareFresh()} disabled={isLoading || isModalOpen || !canPrepareFresh}>
                                    Start New Save
                                </button>
                            </div>
                        </div>

                        <div className="setup-group save-current-group">
                            <label className="field-label" htmlFor="save-profile-input">Save Current Progress</label>
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
                                Destination: <strong>{resolvedSaveDestination || 'Not selected'}</strong>. This copies current `savegame` + `wraps` into that profile.
                            </p>
                            {!hasActiveDestination && saveDestinationMode === 'active' && (
                                <p className="field-hint">No active marker detected yet. Use "Choose destination" or create `active_profile.txt` from Diagnostics.</p>
                            )}
                            <div className="field-row">
                                <button className="action-btn secondary" onClick={() => void onSaveCurrent()} disabled={isLoading || isModalOpen || !canSaveCurrent}>
                                    Save Current Progress
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="panel-block">
                        <h2>Save Setup</h2>
                        <div className="setup-group">
                            <label className="field-label" htmlFor="savegame-path-input">SaveGame Path</label>
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
                            <p className="field-hint">Path must point directly to the `SaveGame` folder.</p>
                        </div>
                    </div>

                    <div className="panel-block">
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
                                {isBundleExpanded ? '▾ Hide Advanced' : '▸ Show Advanced'}
                            </button>
                        </div>

                        {isBundleExpanded && (
                            <div id="bundle-transfer-content" className="bundle-content">
                                <label className="field-label" htmlFor="export-profile-input">Export profile to .zip</label>
                                <div className="field-row bundle-row">
                                    <input
                                        id="export-profile-input"
                                        value={exportProfileName}
                                        onChange={(event) => setExportProfileName(event.target.value)}
                                        placeholder="Profile name to export"
                                        disabled={isLoading || isModalOpen}
                                    />
                                    <input
                                        id="export-bundle-path-input"
                                        value={exportBundlePath}
                                        onChange={(event) => setExportBundlePath(event.target.value)}
                                        placeholder="Destination .zip path"
                                        disabled={isLoading || isModalOpen}
                                    />
                                    <button className="action-btn secondary" onClick={() => void onPickExportBundlePath()} disabled={isLoading || isModalOpen}>
                                        Browse...
                                    </button>
                                </div>
                                <p className="field-hint">Choose where the exported `.zip` will be saved.</p>
                                <button className="action-btn" onClick={() => void onExportBundle()} disabled={isLoading || isModalOpen || !canExportBundle}>
                                    Export Bundle
                                </button>

                                <label className="field-label" htmlFor="import-profile-input">Import .zip into profile</label>
                                <div className="field-row bundle-row">
                                    <input
                                        id="import-profile-input"
                                        value={importProfileName}
                                        onChange={(event) => setImportProfileName(event.target.value)}
                                        placeholder="Target profile name"
                                        disabled={isLoading || isModalOpen}
                                    />
                                    <input
                                        id="import-bundle-path-input"
                                        value={importBundlePath}
                                        onChange={(event) => setImportBundlePath(event.target.value)}
                                        placeholder="Source .zip path"
                                        disabled={isLoading || isModalOpen}
                                    />
                                    <button className="action-btn secondary" onClick={() => void onPickImportBundlePath()} disabled={isLoading || isModalOpen}>
                                        Browse...
                                    </button>
                                </div>
                                <p className="field-hint">Select an exported `.zip` file to restore into the target profile.</p>
                                <button className="action-btn secondary" onClick={() => void onImportBundle()} disabled={isLoading || isModalOpen || !canImportBundle}>
                                    Import Bundle
                                </button>
                            </div>
                        )}
                    </div>
                </section>
            </main>
            <footer className="footnote">
                <p>Marker file: active_profile.txt</p>
            </footer>

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
