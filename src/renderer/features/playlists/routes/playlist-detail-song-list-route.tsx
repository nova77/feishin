import { closeAllModals, openModal } from '@mantine/modals';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { generatePath, useNavigate, useParams } from 'react-router';

import { ListContext, useListContext } from '/@/renderer/context/list-context';
import { playlistsQueries } from '/@/renderer/features/playlists/api/playlists-api';
import { ClientSideSongFilters } from '/@/renderer/features/playlists/components/client-side-song-filters';
import { PlaylistDetailSongListContent } from '/@/renderer/features/playlists/components/playlist-detail-song-list-content';
import { PlaylistDetailSongListHeader } from '/@/renderer/features/playlists/components/playlist-detail-song-list-header';
import {
    PlaylistQueryEditor,
    PlaylistQueryEditorFilters,
    PlaylistQueryEditorRef,
} from '/@/renderer/features/playlists/components/playlist-query-editor';
import { SaveAsPlaylistForm } from '/@/renderer/features/playlists/components/save-as-playlist-form';
import { usePlaylistSongListFilters } from '/@/renderer/features/playlists/hooks/use-playlist-song-list-filters';
import { useUpdatePlaylist } from '/@/renderer/features/playlists/mutations/update-playlist-mutation';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import { ListWithSidebarContainer } from '/@/renderer/features/shared/components/list-with-sidebar-container';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { AppRoute } from '/@/renderer/router/routes';
import {
    PlaylistTarget,
    useCurrentServer,
    usePageSidebar,
    usePlaylistTarget,
} from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { ConfirmModal } from '/@/shared/components/modal/modal';
import { ScrollArea } from '/@/shared/components/scroll-area/scroll-area';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import {
    LibraryItem,
    PlaylistRules,
    ServerType,
    UpdatePlaylistArgs,
    UpdatePlaylistBody,
} from '/@/shared/types/domain-types';
import { ItemListKey } from '/@/shared/types/types';

const toRules = ({ extraFilters, filter }: PlaylistQueryEditorFilters): PlaylistRules => ({
    ...filter,
    limit: extraFilters.limit ?? undefined,
    limitPercent: extraFilters.limitPercent ?? undefined,
    sort: extraFilters.sortBy?.[0] ?? '+dateAdded',
});

const PlaylistSongListFiltersSidebar = () => {
    const { t } = useTranslation();
    const { setIsSidebarOpen } = useListContext();
    const { clear } = usePlaylistSongListFilters();

    return (
        <Stack h="100%" style={{ minHeight: 0 }}>
            <Group justify="space-between" pb={0} pl="md" pr="md" pt="md">
                <Text fw={500} size="xl">
                    {t('common.filters')}
                </Text>
                <Group gap="xs">
                    <Button onClick={clear} size="compact-sm" variant="subtle">
                        {t('common.reset')}
                    </Button>
                    {setIsSidebarOpen && (
                        <ActionIcon
                            icon="unpin"
                            onClick={() => setIsSidebarOpen(false)}
                            size="compact-sm"
                            variant="subtle"
                        />
                    )}
                </Group>
            </Group>
            <ScrollArea style={{ flex: 1, minHeight: 0 }}>
                <ClientSideSongFilters />
            </ScrollArea>
        </Stack>
    );
};

const PlaylistDetailSongListRoute = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { playlistId } = useParams() as { playlistId: string };
    const server = useCurrentServer();

    const detailQuery = useSuspenseQuery({
        ...playlistsQueries.detail({ query: { id: playlistId }, serverId: server?.id }),
    });
    const updatePlaylistMutation = useUpdatePlaylist({});
    const [mode, setMode] = useState<'edit' | 'view'>('view');
    const queryEditorRef = useRef<PlaylistQueryEditorRef>(null);

    const previewMutation = useUpdatePlaylist({});
    const { mutate: mutatePreview } = previewMutation;
    // Request that restores the rules from before the first preview; null when no preview is applied.
    // Mirrored to localStorage so a crash or reload mid-preview is undone on the next visit.
    const previewSnapshotKey = `smart-playlist-preview:${server?.id}:${playlistId}`;
    const previewRestoreArgsRef = useRef<null | UpdatePlaylistArgs>(null);

    const rulesBody = (rules: PlaylistRules): UpdatePlaylistBody => ({
        comment: detailQuery.data.description || '',
        name: detailQuery.data.name,
        ownerId: detailQuery.data.ownerId || '',
        public: detailQuery.data.public || false,
        queryBuilderRules: rules,
        sync: detailQuery.data.sync || false,
    });

    const rulesUpdateArgs = (rules: PlaylistRules): UpdatePlaylistArgs => ({
        apiClientProps: { serverId: detailQuery.data._serverId },
        body: rulesBody(rules),
        query: { id: playlistId },
    });

    const revertPreview = useCallback(() => {
        if (!previewRestoreArgsRef.current) return;
        mutatePreview(previewRestoreArgsRef.current);
        previewRestoreArgsRef.current = null;
        localStorage.removeItem(previewSnapshotKey);
    }, [mutatePreview, previewSnapshotKey]);

    useEffect(() => {
        if (mode === 'view') revertPreview();
    }, [mode, revertPreview]);

    // Leaving the page (sidebar navigation, Save As) also discards the preview
    useEffect(() => revertPreview, [revertPreview]);

    // ponytail: restores unconditionally; rules edited from another client after the crash would be overwritten
    useEffect(() => {
        const snapshot = localStorage.getItem(previewSnapshotKey);
        if (!snapshot) return;
        localStorage.removeItem(previewSnapshotKey);
        mutatePreview(JSON.parse(snapshot) as UpdatePlaylistArgs, {
            onSuccess: () => toast.info({ message: t('form.queryEditor.previewRestored') }),
        });
    }, [mutatePreview, previewSnapshotKey, t]);

    const handlePreview = (filters: PlaylistQueryEditorFilters) => {
        if (!previewRestoreArgsRef.current) {
            previewRestoreArgsRef.current = rulesUpdateArgs(detailQuery.data.rules || {});
            localStorage.setItem(previewSnapshotKey, JSON.stringify(previewRestoreArgsRef.current));
        }
        mutatePreview(rulesUpdateArgs(toRules(filters)));
    };

    const handleSave = (filters: PlaylistQueryEditorFilters) => {
        updatePlaylistMutation.mutate(rulesUpdateArgs(toRules(filters)), {
            onSuccess: () => {
                toast.success({ message: 'Playlist has been saved' });
                previewRestoreArgsRef.current = null;
                localStorage.removeItem(previewSnapshotKey);
                setMode('view');
            },
        });
    };

    const handleSaveAs = (filters: PlaylistQueryEditorFilters) => {
        openModal({
            children: (
                <SaveAsPlaylistForm
                    body={rulesBody(toRules(filters))}
                    onCancel={closeAllModals}
                    onSuccess={(data) =>
                        navigate(
                            generatePath(AppRoute.PLAYLISTS_DETAIL_SONGS, {
                                playlistId: data?.id || '',
                            }),
                        )
                    }
                    serverId={detailQuery.data._serverId}
                />
            ),
            title: t('common.saveAs'),
        });
    };

    const openSaveAndReplaceModal = () => {
        const payload = queryEditorRef.current?.getFiltersForSave();
        if (!payload) return;

        openModal({
            children: (
                <ConfirmModal
                    onConfirm={() => {
                        handleSave(payload);
                        closeAllModals();
                    }}
                >
                    <Text>{t('common.areYouSure')}</Text>
                </ConfirmModal>
            ),
            title: t('common.saveAndReplace'),
        });
    };

    const isSmartPlaylist = Boolean(
        detailQuery?.data?.rules && server?.type === ServerType.NAVIDROME,
    );

    const playlistTarget = usePlaylistTarget();
    const displayMode: LibraryItem.ALBUM | LibraryItem.SONG =
        playlistTarget === PlaylistTarget.ALBUM ? LibraryItem.ALBUM : LibraryItem.SONG;
    const listKey =
        displayMode === LibraryItem.ALBUM ? ItemListKey.PLAYLIST_ALBUM : ItemListKey.PLAYLIST_SONG;

    const [itemCount, setItemCount] = useState<number | undefined>(undefined);
    const [listData, setListData] = useState<unknown[]>([]);
    const [isSidebarOpen, setIsSidebarOpen] = usePageSidebar(listKey);

    const providerValue = useMemo(() => {
        return {
            customFilters: undefined,
            displayMode,
            id: playlistId,
            isSidebarOpen,
            isSmartPlaylist,
            itemCount,
            listData,
            listKey,
            mode,
            pageKey: listKey,
            setIsSidebarOpen,
            setItemCount,
            setListData,
            setMode,
        };
    }, [
        playlistId,
        isSmartPlaylist,
        displayMode,
        listKey,
        isSidebarOpen,
        itemCount,
        listData,
        mode,
        setIsSidebarOpen,
    ]);

    const isEditingSmartPlaylist = isSmartPlaylist && mode === 'edit';

    const editActions = isEditingSmartPlaylist && (
        <>
            <Button
                leftSection={<Icon icon="save" />}
                onClick={() => {
                    const payload = queryEditorRef.current?.getFiltersForSave();
                    if (payload) handleSaveAs(payload);
                }}
                size="sm"
                variant="subtle"
            >
                {t('common.saveAs')}
            </Button>
            <Button
                leftSection={<Icon color="error" icon="save" />}
                loading={updatePlaylistMutation.isPending}
                onClick={openSaveAndReplaceModal}
                size="sm"
                variant="subtle"
            >
                {t('common.saveAndReplace')}
            </Button>
        </>
    );

    return (
        <AnimatedPage key={`playlist-detail-songList-${playlistId}`}>
            <ListContext.Provider value={providerValue}>
                <PlaylistDetailSongListHeader
                    editActions={editActions}
                    isSmartPlaylist={!!isSmartPlaylist}
                />

                <ListWithSidebarContainer>
                    <ListWithSidebarContainer.SidebarPortal>
                        <Suspense fallback={<Spinner container />}>
                            <PlaylistSongListFiltersSidebar />
                        </Suspense>
                    </ListWithSidebarContainer.SidebarPortal>
                    <Suspense fallback={<Spinner container />}>
                        <PlaylistDetailSongListContent />
                    </Suspense>
                </ListWithSidebarContainer>
                {isEditingSmartPlaylist && (
                    <PlaylistQueryEditor
                        detailQuery={detailQuery}
                        isPreviewPending={previewMutation.isPending}
                        onPreview={handlePreview}
                        playlistId={playlistId}
                        ref={queryEditorRef}
                    />
                )}
            </ListContext.Provider>
        </AnimatedPage>
    );
};

const PlaylistDetailSongListRouteWithBoundary = () => {
    const { playlistId } = useParams() as { playlistId: string };

    return (
        <PageErrorBoundary>
            <PlaylistDetailSongListRoute key={playlistId} />
        </PageErrorBoundary>
    );
};

export default PlaylistDetailSongListRouteWithBoundary;
