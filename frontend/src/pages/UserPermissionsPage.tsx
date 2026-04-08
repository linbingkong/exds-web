import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, Drawer, FormControl, FormControlLabel, Grid, IconButton, InputLabel, List, ListItemButton, ListItemText, Menu,
  MenuItem, Paper, Select, SelectChangeEvent, Stack, Switch, Table, TableBody, TableCell,
  TableContainer, TableHead, TablePagination, TableRow, TextField, Tooltip, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import HistoryIcon from '@mui/icons-material/History';
import SaveIcon from '@mui/icons-material/Save';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { useAuth } from '../contexts/AuthContext';
import {
  AuthAuditLog,
  AuthSession,
  AuthModule,
  AuthPermission,
  AuthRole,
  AuthUser,
  createRole,
  createUser,
  deleteRole,
  deleteUser,
  listAuditLogs,
  listAuthSessions,
  listModules,
  listPermissions,
  listRoles,
  listUsers,
  resetUserPassword,
  updateRole,
  updateRolePermissions,
  updateUserEmailMfa,
  updateUserRoles,
  updateUserStatus,
} from '../api/authManagement';

const MODULE_PERMISSION_PATTERN = /^module:(.+):(view|edit)$/;
const VIEW_REAL_CUSTOMER_NAME_PERMISSION = 'data:customer_name:view_real';

type RoleDraft = { code: string; name: string; description: string };
type UserDraft = {
  username: string;
  password: string;
  display_name: string;
  email: string;
  require_email_verification: boolean;
  email_mfa_enabled: boolean;
  roles: string[];
};

const UserPermissionsPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('system:auth:manage');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [roles, setRoles] = useState<AuthRole[]>([]);
  const [modules, setModules] = useState<AuthModule[]>([]);
  const [permissions, setPermissions] = useState<AuthPermission[]>([]);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [userPage, setUserPage] = useState(0);
  const [userPageSize, setUserPageSize] = useState(10);

  const [selectedRoleCode, setSelectedRoleCode] = useState('');
  const [selectedUser, setSelectedUser] = useState<AuthUser | null>(null);
  const [rolePermDraft, setRolePermDraft] = useState<string[]>([]);

  const [createRoleOpen, setCreateRoleOpen] = useState(false);
  const [deleteRoleOpen, setDeleteRoleOpen] = useState(false);
  const [editRoleOpen, setEditRoleOpen] = useState(false);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [assignRoleOpen, setAssignRoleOpen] = useState(false);
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [deleteUserOpen, setDeleteUserOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);

  const [roleDraft, setRoleDraft] = useState<RoleDraft>({ code: '', name: '', description: '' });
  const [editRoleDraft, setEditRoleDraft] = useState({ name: '', description: '' });
  const [userDraft, setUserDraft] = useState<UserDraft>({
    username: '',
    password: '',
    display_name: '',
    email: '',
    require_email_verification: true,
    email_mfa_enabled: false,
    roles: [],
  });
  const [assignRoles, setAssignRoles] = useState<string[]>([]);
  const [targetUser, setTargetUser] = useState<AuthUser | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [userActionAnchor, setUserActionAnchor] = useState<null | HTMLElement>(null);
  const [userActionTarget, setUserActionTarget] = useState<AuthUser | null>(null);

  const [auditLogs, setAuditLogs] = useState<AuthAuditLog[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(0);
  const [auditPageSize, setAuditPageSize] = useState(10);
  const [auditLoading, setAuditLoading] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionTargetUser, setSessionTargetUser] = useState<AuthUser | null>(null);
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [sessionPage, setSessionPage] = useState(0);
  const [sessionPageSize, setSessionPageSize] = useState(10);
  const [sessionLoading, setSessionLoading] = useState(false);

  const selectedRole = useMemo(() => roles.find((r) => r.code === selectedRoleCode) || null, [roles, selectedRoleCode]);

  const modulePerms = useMemo(() => {
    const moduleMetaMap = new Map(modules.map((m) => [m.module_code, m]));
    const map = new Map<string, { view?: string; edit?: string; label: string }>();
    permissions.forEach((p) => {
      const m = p.code.match(MODULE_PERMISSION_PATTERN);
      if (!m) return;
      const moduleCode = m[1];
      const level = m[2] as 'view' | 'edit';
      const cur = map.get(moduleCode) || { label: moduleCode };
      cur[level] = p.code;
      cur.label = moduleMetaMap.get(moduleCode)?.module_name
        || ((cur.label === moduleCode && p.name) ? p.name.replace(/-可查看$/, '') : cur.label);
      map.set(moduleCode, cur);
    });
    return Array.from(map.entries())
      .map(([moduleCode, v]) => ({ moduleCode, ...v }))
      .sort((a, b) => {
        const ao = moduleMetaMap.get(a.moduleCode)?.sort_order ?? Number.MAX_SAFE_INTEGER;
        const bo = moduleMetaMap.get(b.moduleCode)?.sort_order ?? Number.MAX_SAFE_INTEGER;
        if (ao !== bo) {
          return ao - bo;
        }
        return a.label.localeCompare(b.label, 'zh-CN');
      });
  }, [permissions, modules]);

  const extraPerms = useMemo(() => {
    return permissions
      .filter((p) => p.is_exception && p.code !== VIEW_REAL_CUSTOMER_NAME_PERMISSION)
      .sort((a, b) => (a.name || a.code).localeCompare(b.name || b.code, 'zh-CN'));
  }, [permissions]);

  const realCustomerNamePermission = useMemo(
    () => permissions.find((p) => p.code === VIEW_REAL_CUSTOMER_NAME_PERMISSION) || null,
    [permissions]
  );

  const loadUsers = useCallback(async () => {
    if (!canManage) {
      setUsers([]);
      setUsersTotal(0);
      return;
    }
    const data = await listUsers(userPage + 1, userPageSize);
    setUsers(data.items);
    setUsersTotal(data.total);
  }, [canManage, userPage, userPageSize]);

  const loadBase = useCallback(async () => {
    if (!canManage) {
      setRoles([]);
      setPermissions([]);
      setModules([]);
      setUsers([]);
      setUsersTotal(0);
      setSelectedRoleCode('');
      return;
    }
    setError(null);
    try {
      const [roleData, permData, moduleData] = await Promise.all([listRoles(), listPermissions(), listModules()]);
      setRoles(roleData.items);
      setPermissions(permData.items);
      setModules(moduleData.items);
      setSelectedRoleCode((prev) => {
        if (prev && roleData.items.some((r) => r.code === prev)) {
          return prev;
        }
        return roleData.items[0]?.code || '';
      });
      await loadUsers();
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '加载失败');
    }
  }, [canManage, loadUsers]);

  const loadAudit = useCallback(async () => {
    if (!canManage) {
      setAuditLogs([]);
      setAuditTotal(0);
      return;
    }
    setAuditLoading(true);
    try {
      const data = await listAuditLogs({ page: auditPage + 1, pageSize: auditPageSize });
      setAuditLogs(data.items);
      setAuditTotal(data.total);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '审计日志加载失败');
    } finally {
      setAuditLoading(false);
    }
  }, [canManage, auditPage, auditPageSize]);

  const loadSessions = useCallback(async () => {
    if (!canManage || !sessionTargetUser?.username) {
      setSessions([]);
      setSessionTotal(0);
      return;
    }
    setSessionLoading(true);
    try {
      const data = await listAuthSessions({
        username: sessionTargetUser.username,
        page: sessionPage + 1,
        pageSize: sessionPageSize,
      });
      setSessions(data.items);
      setSessionTotal(data.total);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '会话信息加载失败');
    } finally {
      setSessionLoading(false);
    }
  }, [canManage, sessionTargetUser?.username, sessionPage, sessionPageSize]);

  useEffect(() => {
    setInitialLoading(true);
    loadBase().finally(() => setInitialLoading(false));
  }, [loadBase]);
  useEffect(() => { if (canManage) loadUsers(); }, [canManage, loadUsers]);
  useEffect(() => { if (selectedRole) setRolePermDraft(selectedRole.permissions || []); }, [selectedRole]);
  useEffect(() => { if (auditOpen) loadAudit(); }, [auditOpen, loadAudit]);
  useEffect(() => { if (sessionOpen) void loadSessions(); }, [sessionOpen, loadSessions]);

  const onRefresh = async () => {
    if (!canManage) return;
    setRefreshing(true);
    await loadBase();
    setRefreshing(false);
  };

  const onToggleModulePerm = (moduleCode: string, level: 'view' | 'edit', checked: boolean) => {
    const item = modulePerms.find((m) => m.moduleCode === moduleCode);
    if (!item) return;
    const next = new Set(rolePermDraft);
    if (level === 'edit') {
      if (checked) {
        if (item.edit) next.add(item.edit);
        if (item.view) next.add(item.view);
      } else if (item.edit) next.delete(item.edit);
    } else if (checked) {
      if (item.view) next.add(item.view);
    } else {
      if (item.view) next.delete(item.view);
      if (item.edit) next.delete(item.edit);
    }
    setRolePermDraft(Array.from(next));
  };

  const onToggleExtraPerm = (code: string, checked: boolean) => {
    const next = new Set(rolePermDraft);
    if (checked) next.add(code); else next.delete(code);
    setRolePermDraft(Array.from(next));
  };

  const onCreateRole = async () => {
    if (!roleDraft.code || !roleDraft.name) {
      setError('角色编码和名称不能为空');
      return;
    }
    setSaving(true);
    try {
      const code = roleDraft.code.trim();
      await createRole({ code, name: roleDraft.name.trim(), description: roleDraft.description.trim() || undefined, permissions: [] });
      setMessage('角色创建成功');
      setCreateRoleOpen(false);
      setRoleDraft({ code: '', name: '', description: '' });
      await loadBase();
      setSelectedRoleCode(code);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '创建角色失败');
    } finally {
      setSaving(false);
    }
  };

  const onCreateUser = async () => {
    if (!userDraft.username) {
      setError('用户名不能为空');
      return;
    }
    setSaving(true);
    try {
      await createUser({
        ...userDraft,
        username: userDraft.username.trim(),
        password: userDraft.password.trim() || undefined,
        email: userDraft.email.trim() || undefined,
        email_mfa_enabled: userDraft.email_mfa_enabled,
        display_name: userDraft.display_name.trim() || undefined
      });
      setMessage('用户创建成功');
      setCreateUserOpen(false);
      setUserDraft({
        username: '',
        password: '',
        display_name: '',
        email: '',
        require_email_verification: true,
        email_mfa_enabled: false,
        roles: [],
      });
      await loadUsers();
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '创建用户失败');
    } finally {
      setSaving(false);
    }
  };

  const onSaveRolePerms = async () => {
    if (!selectedRole) return;
    setSaving(true);
    try {
      await updateRolePermissions(selectedRole.code, rolePermDraft);
      setMessage('角色权限已保存');
      await onRefresh();
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '保存权限失败');
    } finally {
      setSaving(false);
    }
  };

  const onAssignRoles = async () => {
    if (!selectedUser) return;
    const nextRole = assignRoles[0];
    if (!nextRole) {
      setError('请选择角色');
      return;
    }
    setSaving(true);
    try {
      await updateUserRoles(selectedUser.username, [nextRole]);
      setMessage('用户角色更新成功');
      setAssignRoleOpen(false);
      await loadUsers();
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '更新用户角色失败');
    } finally {
      setSaving(false);
    }
  };

  const onDeleteRole = async () => {
    if (!selectedRole) return;
    setSaving(true);
    try {
      await deleteRole(selectedRole.code);
      setMessage('角色删除成功');
      setDeleteRoleOpen(false);
      await onRefresh();
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '删除角色失败');
    } finally {
      setSaving(false);
    }
  };

  const onOpenEditRole = () => {
    if (!selectedRole) return;
    setEditRoleDraft({
      name: selectedRole.name || '',
      description: selectedRole.description || '',
    });
    setEditRoleOpen(true);
  };

  const onUpdateRole = async () => {
    if (!selectedRole) return;
    const nextName = editRoleDraft.name.trim();
    if (!nextName) {
      setError('角色名称不能为空');
      return;
    }
    setSaving(true);
    try {
      await updateRole(selectedRole.code, {
        name: nextName,
        description: editRoleDraft.description.trim() || undefined,
      });
      setMessage('角色信息更新成功');
      setEditRoleOpen(false);
      await loadBase();
      setSelectedRoleCode(selectedRole.code);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '更新角色失败');
    } finally {
      setSaving(false);
    }
  };

  const onToggleUserStatus = async (user: AuthUser) => {
    setSaving(true);
    try {
      await updateUserStatus(user.username, !user.is_active);
      setMessage('用户状态已更新');
      await loadUsers();
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '更新用户状态失败');
    } finally {
      setSaving(false);
    }
  };

  const onToggleUserEmailMfa = async (user: AuthUser) => {
    setSaving(true);
    try {
      await updateUserEmailMfa(user.username, !user.email_mfa_enabled);
      setMessage('新设备邮件验证状态已更新');
      await loadUsers();
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '更新新设备邮件验证状态失败');
    } finally {
      setSaving(false);
    }
  };

  const onResetPassword = async () => {
    if (!targetUser) return;
    setSaving(true);
    try {
      await resetUserPassword(targetUser.username, newPassword.trim() || undefined);
      setMessage(`用户 ${targetUser.username} 密码已重置`);
      setResetPasswordOpen(false);
      setTargetUser(null);
      setNewPassword('');
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '重置密码失败');
    } finally {
      setSaving(false);
    }
  };

  const onDeleteUser = async () => {
    if (!targetUser) return;
    setSaving(true);
    try {
      await deleteUser(targetUser.username);
      setMessage(`用户 ${targetUser.username} 已删除`);
      setDeleteUserOpen(false);
      setTargetUser(null);
      await loadUsers();
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '删除用户失败');
    } finally {
      setSaving(false);
    }
  };

  const openUserActionMenu = (event: React.MouseEvent<HTMLElement>, user: AuthUser) => {
    setUserActionAnchor(event.currentTarget);
    setUserActionTarget(user);
  };

  const closeUserActionMenu = () => {
    setUserActionAnchor(null);
    setUserActionTarget(null);
  };

  if (initialLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="300px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'stretch', md: 'center' }}>
          <Box>
            <Typography variant="h6">用户与权限管理</Typography>
            <Typography variant="body2" color="text.secondary">角色、用户、权限矩阵与审计管理</Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" startIcon={<HistoryIcon />} onClick={() => setAuditOpen(true)} disabled={!canManage}>审计日志</Button>
            <Button variant="outlined" onClick={onRefresh} disabled={saving || refreshing}>{refreshing ? '刷新中...' : '刷新'}</Button>
          </Stack>
        </Stack>
        {!canManage && <Alert severity="warning" sx={{ mt: 2 }}>当前账号缺少 `system:auth:manage`，仅可查看。</Alert>}
        {error && <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>{error}</Alert>}
        {message && <Alert severity="success" sx={{ mt: 2 }} onClose={() => setMessage(null)}>{message}</Alert>}
      </Paper>

      {!canManage ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Alert severity="info">当前账号仅具备页面访问权限，不可进入用户与权限管理功能区。</Alert>
        </Paper>
      ) : (

      <Grid container spacing={{ xs: 1, sm: 2 }} alignItems="stretch">
        <Grid size={{ xs: 12, md: 5 }} sx={{ display: 'flex' }}>
          <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 560 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1} sx={{ mb: 1 }}>
              <Typography variant="subtitle1">用户列表</Typography>
              <Button size="small" startIcon={<PersonAddIcon />} onClick={() => setCreateUserOpen(true)} disabled={!canManage || saving}>新建用户</Button>
            </Stack>
            <TableContainer sx={{ overflowX: 'auto', flex: 1, width: '100%' }}>
              <Table
                size="small"
                sx={{
                  width: '100%',
                  tableLayout: isMobile ? 'fixed' : 'auto',
                }}
              >
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: isMobile ? '50%' : 'auto' }}>用户名</TableCell>
                    {!isMobile && <TableCell>角色</TableCell>}
                    <TableCell>状态</TableCell>
                    <TableCell align="right" sx={{ width: 72 }}>操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.username} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600}>{u.username}</Typography>
                        <Typography variant="caption" color="text.secondary">{u.display_name || '-'}</Typography>
                        {!isMobile && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {u.email ? `${u.email} · ${u.email_verified ? '邮箱已验证' : '邮箱待验证'} · ${u.email_mfa_enabled ? '新设备验证已开启' : '新设备验证已关闭'}` : '未绑定邮箱'}
                          </Typography>
                        )}
                        {isMobile && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            display="block"
                            sx={{ mt: 0.25, wordBreak: 'break-all', whiteSpace: 'normal' }}
                          >
                            {[
                              (u.roles || []).join(', ') || '-',
                              u.email ? (u.email_verified ? '邮箱已验证' : '邮箱待验证') : '未绑定邮箱',
                              u.email_mfa_enabled ? '新设备验证已开启' : '新设备验证已关闭',
                            ].join(' · ')}
                          </Typography>
                        )}
                      </TableCell>
                      {!isMobile && (
                        <TableCell sx={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>
                          {(u.roles || []).join(', ') || '-'}
                        </TableCell>
                      )}
                      <TableCell><Chip size="small" label={u.is_active ? '启用' : '禁用'} color={u.is_active ? 'success' : 'default'} /></TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap', width: 96 }}>
                        <IconButton
                          size="small"
                          disabled={!canManage || saving}
                          onClick={(e) => openUserActionMenu(e, u)}
                        >
                          <ArrowDropDownIcon />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                  {users.length === 0 && <TableRow><TableCell colSpan={isMobile ? 3 : 4} align="center">暂无数据</TableCell></TableRow>}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={usersTotal}
              page={userPage}
              rowsPerPage={userPageSize}
              onPageChange={(_, p) => setUserPage(p)}
              onRowsPerPageChange={(e) => { setUserPageSize(parseInt(e.target.value, 10)); setUserPage(0); }}
              rowsPerPageOptions={[10, 20, 50]}
              sx={isMobile ? { '& .MuiTablePagination-toolbar': { flexWrap: 'wrap', rowGap: 0.5, px: 0 } } : undefined}
            />
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, md: 3 }} sx={{ display: 'flex' }}>
          <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 560 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="subtitle1">角色列表</Typography>
              <Stack direction="row" spacing={0.5}>
                <Button size="small" startIcon={<AddIcon />} onClick={() => setCreateRoleOpen(true)} disabled={!canManage || saving}>新建</Button>
                <Tooltip title={!selectedRole ? '请选择角色' : (selectedRole.is_system ? '系统角色不允许编辑' : '编辑角色')}>
                  <span>
                    <IconButton
                      size="small"
                      color="primary"
                      onClick={onOpenEditRole}
                      disabled={!canManage || saving || !selectedRole || !!selectedRole.is_system}
                    >
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={!selectedRole ? '请选择角色' : (selectedRole.is_system ? '系统角色不允许删除' : '删除角色')}>
                  <span>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => setDeleteRoleOpen(true)}
                      disabled={!canManage || saving || !selectedRole || !!selectedRole.is_system}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            </Stack>
            <Divider sx={{ mb: 1 }} />
            <List dense sx={{ overflowY: 'auto', flex: 1 }}>
              {roles.map((role) => (
                <ListItemButton key={role.code} selected={role.code === selectedRoleCode} onClick={() => setSelectedRoleCode(role.code)}>
                  <ListItemText
                    primary={<Stack direction="row" spacing={1} alignItems="center"><span>{role.name}</span>{role.is_system && <Chip size="small" label="系统" />}</Stack>}
                    secondary={`${role.code} · ${role.permissions?.length || 0} 权限`}
                  />
                </ListItemButton>
              ))}
            </List>
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }} sx={{ display: 'flex' }}>
          <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, flex: 1, minHeight: 560 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="subtitle1">权限详情</Typography>
              <Button size="small" variant="contained" startIcon={<SaveIcon />} onClick={onSaveRolePerms} disabled={!selectedRole || !canManage || saving}>保存</Button>
            </Stack>
            {!selectedRole ? <Alert severity="info">请选择角色</Alert> : (
              <>
                <Typography variant="body2" fontWeight={600}>{selectedRole.name}</Typography>
                <Typography variant="caption" color="text.secondary">{selectedRole.code}</Typography>
                <Divider sx={{ my: 1 }} />
                <Box sx={{ maxHeight: 360, overflowY: 'auto' }}>
                  <Table size="small">
                    <TableHead><TableRow><TableCell>模块</TableCell><TableCell align="center">view</TableCell><TableCell align="center">edit</TableCell></TableRow></TableHead>
                    <TableBody>
                      {modulePerms.map((m) => (
                        <TableRow key={m.moduleCode}>
                          <TableCell>{m.label}</TableCell>
                          <TableCell align="center"><Switch size="small" disabled={!canManage || !m.view} checked={!!(m.view && rolePermDraft.includes(m.view))} onChange={(e) => onToggleModulePerm(m.moduleCode, 'view', e.target.checked)} /></TableCell>
                          <TableCell align="center"><Switch size="small" disabled={!canManage || !m.edit} checked={!!(m.edit && rolePermDraft.includes(m.edit))} onChange={(e) => onToggleModulePerm(m.moduleCode, 'edit', e.target.checked)} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
                <Divider sx={{ my: 1 }} />
                <Typography variant="body2" fontWeight={600}>客户名称查看控制</Typography>
                <Paper variant="outlined" sx={{ mt: 0.5, p: 1.5 }}>
                  <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="space-between">
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2">
                        查看真实客户名称
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block">
                        打开后该角色可直接查看真实客户名称；关闭后按演示脱敏规则显示。
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block">
                        {realCustomerNamePermission?.code || VIEW_REAL_CUSTOMER_NAME_PERMISSION}
                      </Typography>
                    </Box>
                    <Switch
                      size="small"
                      disabled={!canManage || !realCustomerNamePermission}
                      checked={rolePermDraft.includes(VIEW_REAL_CUSTOMER_NAME_PERMISSION)}
                      onChange={(e) => onToggleExtraPerm(VIEW_REAL_CUSTOMER_NAME_PERMISSION, e.target.checked)}
                    />
                  </Stack>
                </Paper>
                <Divider sx={{ my: 1 }} />
                <Typography variant="body2" fontWeight={600}>其他例外权限</Typography>
                <Stack spacing={0.5} sx={{ maxHeight: 160, overflowY: 'auto', mt: 0.5 }}>
                  {extraPerms.map((p) => (
                    <Stack key={p.code} direction="row" spacing={1} alignItems="center">
                      <Switch size="small" disabled={!canManage} checked={rolePermDraft.includes(p.code)} onChange={(e) => onToggleExtraPerm(p.code, e.target.checked)} />
                      <Box><Typography variant="caption">{p.name || p.code}</Typography><Typography variant="caption" color="text.secondary" display="block">{p.code}</Typography></Box>
                    </Stack>
                  ))}
                  {extraPerms.length === 0 && (
                    <Typography variant="caption" color="text.secondary">暂无其他例外权限</Typography>
                  )}
                </Stack>
              </>
            )}
          </Paper>
        </Grid>
      </Grid>
      )}

      <Dialog open={createRoleOpen} onClose={() => setCreateRoleOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>新建角色</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="角色编码" value={roleDraft.code} onChange={(e) => setRoleDraft((s) => ({ ...s, code: e.target.value }))} />
            <TextField label="角色名称" value={roleDraft.name} onChange={(e) => setRoleDraft((s) => ({ ...s, name: e.target.value }))} />
            <TextField label="描述" value={roleDraft.description} onChange={(e) => setRoleDraft((s) => ({ ...s, description: e.target.value }))} multiline minRows={2} />
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setCreateRoleOpen(false)}>取消</Button><Button variant="contained" onClick={onCreateRole} disabled={!canManage || saving}>创建</Button></DialogActions>
      </Dialog>

      <Dialog open={deleteRoleOpen} onClose={() => setDeleteRoleOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>删除角色</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            确认删除角色 {selectedRole?.name}（{selectedRole?.code}）？
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteRoleOpen(false)}>取消</Button>
          <Button color="error" variant="contained" onClick={onDeleteRole} disabled={!canManage || saving || !selectedRole}>删除</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={editRoleOpen} onClose={() => setEditRoleOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>编辑角色</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="角色编码" value={selectedRole?.code || ''} disabled />
            <TextField
              label="角色名称"
              value={editRoleDraft.name}
              onChange={(e) => setEditRoleDraft((s) => ({ ...s, name: e.target.value }))}
            />
            <TextField
              label="描述"
              value={editRoleDraft.description}
              onChange={(e) => setEditRoleDraft((s) => ({ ...s, description: e.target.value }))}
              multiline
              minRows={2}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditRoleOpen(false)}>取消</Button>
          <Button variant="contained" onClick={onUpdateRole} disabled={!canManage || saving || !selectedRole}>保存</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={createUserOpen} onClose={() => setCreateUserOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>新建用户</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="用户名"
              value={userDraft.username}
              onChange={(e) => setUserDraft((s) => ({ ...s, username: e.target.value }))}
              autoComplete="new-username"
            />
            <TextField
              label="密码（留空使用系统默认密码）"
              type="password"
              value={userDraft.password}
              onChange={(e) => setUserDraft((s) => ({ ...s, password: e.target.value }))}
              autoComplete="new-password"
            />
            <TextField label="显示名" value={userDraft.display_name} onChange={(e) => setUserDraft((s) => ({ ...s, display_name: e.target.value }))} />
            <TextField label="邮箱" value={userDraft.email} onChange={(e) => setUserDraft((s) => ({ ...s, email: e.target.value }))} />
            <FormControlLabel
              control={(
                <Checkbox
                  checked={userDraft.require_email_verification}
                  onChange={(e) => setUserDraft((s) => ({ ...s, require_email_verification: e.target.checked }))}
                />
              )}
              label="首次登录要求邮箱验证"
            />
            <Typography variant="caption" color="text.secondary">
              默认选中。若未填写邮箱，后续安全流程仍需先绑定邮箱。
            </Typography>
            <FormControlLabel
              control={(
                <Checkbox
                  checked={userDraft.email_mfa_enabled}
                  onChange={(e) => setUserDraft((s) => ({ ...s, email_mfa_enabled: e.target.checked }))}
                />
              )}
              label="开启新设备邮件验证码"
            />
            <Typography variant="caption" color="text.secondary">
              仅当用户已绑定并验证邮箱后才会在新设备登录时生效。
            </Typography>
            <FormControl fullWidth>
              <InputLabel id="create-user-role-select">角色（单选）</InputLabel>
              <Select
                labelId="create-user-role-select"
                value={userDraft.roles[0] || ''}
                label="角色（单选）"
                onChange={(e: SelectChangeEvent<string>) => setUserDraft((s) => ({ ...s, roles: e.target.value ? [e.target.value] : [] }))}
              >
                {roles.map((r) => <MenuItem key={r.code} value={r.code}>{r.name} ({r.code})</MenuItem>)}
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setCreateUserOpen(false)}>取消</Button><Button variant="contained" onClick={onCreateUser} disabled={!canManage || saving}>创建</Button></DialogActions>
      </Dialog>

      <Dialog open={assignRoleOpen} onClose={() => setAssignRoleOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>分配角色：{selectedUser?.username}</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 1 }}>
            <InputLabel id="assign-role-select">角色（单选）</InputLabel>
            <Select
              labelId="assign-role-select"
              value={assignRoles[0] || ''}
              label="角色（单选）"
              onChange={(e: SelectChangeEvent<string>) => setAssignRoles(e.target.value ? [e.target.value] : [])}
            >
              {roles.map((r) => <MenuItem key={r.code} value={r.code}>{r.name} ({r.code})</MenuItem>)}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions><Button onClick={() => setAssignRoleOpen(false)}>取消</Button><Button variant="contained" onClick={onAssignRoles} disabled={!canManage || saving}>保存</Button></DialogActions>
      </Dialog>

      <Dialog open={resetPasswordOpen} onClose={() => setResetPasswordOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>重置密码</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            <Typography variant="body2">用户：{targetUser?.username}</Typography>
            <TextField
              label="新密码（留空使用系统默认密码）"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetPasswordOpen(false)}>取消</Button>
          <Button variant="contained" onClick={onResetPassword} disabled={!canManage || saving}>确认重置</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteUserOpen} onClose={() => setDeleteUserOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>删除用户</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            确认删除用户 {targetUser?.username}？
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteUserOpen(false)}>取消</Button>
          <Button color="error" variant="contained" onClick={onDeleteUser} disabled={!canManage || saving}>删除</Button>
        </DialogActions>
      </Dialog>

      <Menu anchorEl={userActionAnchor} open={Boolean(userActionAnchor)} onClose={closeUserActionMenu}>
        <MenuItem
          disabled={!canManage || saving || !userActionTarget}
          onClick={() => {
            if (!userActionTarget) return;
            setSelectedUser(userActionTarget);
            setAssignRoles(userActionTarget.roles?.[0] ? [userActionTarget.roles[0]] : []);
            setAssignRoleOpen(true);
            closeUserActionMenu();
          }}
        >
          分配角色
        </MenuItem>
        <MenuItem
          disabled={!canManage || saving || !userActionTarget}
          onClick={() => {
            if (!userActionTarget) return;
            void onToggleUserEmailMfa(userActionTarget);
            closeUserActionMenu();
          }}
        >
          {userActionTarget?.email_mfa_enabled ? '关闭新设备邮件验证' : '开启新设备邮件验证'}
        </MenuItem>
        <MenuItem
          disabled={!canManage || saving || !userActionTarget}
          onClick={() => {
            if (!userActionTarget) return;
            setSessionTargetUser(userActionTarget);
            setSessionPage(0);
            setSessionOpen(true);
            closeUserActionMenu();
          }}
        >
          查看会话信息
        </MenuItem>
        <MenuItem
          disabled={!canManage || saving || !userActionTarget}
          onClick={() => {
            if (!userActionTarget) return;
            void onToggleUserStatus(userActionTarget);
            closeUserActionMenu();
          }}
        >
          {userActionTarget?.is_active ? '禁用用户' : '启用用户'}
        </MenuItem>
        <MenuItem
          disabled={!canManage || saving || !userActionTarget}
          onClick={() => {
            if (!userActionTarget) return;
            setTargetUser(userActionTarget);
            setNewPassword('');
            setResetPasswordOpen(true);
            closeUserActionMenu();
          }}
        >
          重置密码
        </MenuItem>
        <MenuItem
          disabled={!canManage || saving || !userActionTarget || !!userActionTarget?.is_active}
          onClick={() => {
            if (!userActionTarget) return;
            setTargetUser(userActionTarget);
            setDeleteUserOpen(true);
            closeUserActionMenu();
          }}
        >
          删除用户
        </MenuItem>
      </Menu>

      <Drawer
        anchor="right"
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        sx={{
          '& .MuiDrawer-paper': {
            top: { xs: 56, sm: 64 },
            height: { xs: 'calc(100% - 56px)', sm: 'calc(100% - 64px)' },
          },
        }}
      >
        <Box sx={{ width: { xs: '100vw', sm: 760 }, p: 2 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>审计日志</Typography>
          <Box
            sx={{
              mb: 1.5,
              px: 1.5,
              py: 1,
              borderRadius: 1,
              bgcolor: 'action.hover',
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Typography variant="body2" color="text.secondary">
              共 {auditTotal} 条审计记录，支持分页查看最近认证与权限变更操作。
            </Typography>
          </Box>
          {auditLoading ? <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box> : (
            <>
              <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: '70vh', mt: 1.5 }}>
                <Table size="small" stickyHeader>
                  <TableHead><TableRow><TableCell>时间</TableCell><TableCell>事件</TableCell><TableCell>操作人</TableCell><TableCell>目标</TableCell></TableRow></TableHead>
                  <TableBody>
                    {auditLogs.map((log, i) => (
                      <TableRow key={`${log.created_at}-${i}`}>
                        <TableCell>{(log.created_at || '').replace('T', ' ').slice(0, 19)}</TableCell>
                        <TableCell>{log.event}</TableCell>
                        <TableCell>{log.operator}</TableCell>
                        <TableCell>{log.target || '-'}</TableCell>
                      </TableRow>
                    ))}
                    {auditLogs.length === 0 && <TableRow><TableCell colSpan={4} align="center">暂无数据</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </TableContainer>
              <TablePagination component="div" count={auditTotal} page={auditPage} rowsPerPage={auditPageSize} onPageChange={(_, p) => setAuditPage(p)} onRowsPerPageChange={(e) => { setAuditPageSize(parseInt(e.target.value, 10)); setAuditPage(0); }} rowsPerPageOptions={[10, 20, 50]} />
            </>
          )}
        </Box>
      </Drawer>

      <Drawer
        anchor="right"
        open={sessionOpen}
        onClose={() => setSessionOpen(false)}
        sx={{
          '& .MuiDrawer-paper': {
            top: { xs: 56, sm: 64 },
            height: { xs: 'calc(100% - 56px)', sm: 'calc(100% - 64px)' },
          },
        }}
      >
        <Box sx={{ width: { xs: '100vw', sm: 980 }, p: 2 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            用户会话信息
          </Typography>
          <Box
            sx={{
              mb: 1.5,
              px: 1.5,
              py: 1,
              borderRadius: 1,
              bgcolor: 'action.hover',
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'normal', wordBreak: 'break-all' }}>
              用户：{sessionTargetUser?.username || '-'}
            </Typography>
          </Box>
          {sessionLoading ? <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box> : (
            <>
              <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: '70vh', mt: 1.5 }}>
                <Table
                  size="small"
                  stickyHeader
                  sx={{
                    minWidth: 940,
                    tableLayout: 'fixed',
                    '& .MuiTableCell-root': {
                      whiteSpace: 'normal',
                      wordBreak: 'break-all',
                      lineHeight: 1.35,
                    },
                  }}
                >
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: 168 }}>登录时间</TableCell>
                      <TableCell sx={{ width: 96 }}>状态</TableCell>
                      <TableCell sx={{ width: 150 }}>登录IP</TableCell>
                      <TableCell sx={{ width: 140 }}>城市</TableCell>
                      <TableCell sx={{ width: 168 }}>登出时间</TableCell>
                      <TableCell sx={{ width: 92 }}>时长(秒)</TableCell>
                      <TableCell sx={{ width: 126 }}>原因</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sessions.map((s, i) => (
                      <TableRow key={`${s.sid}-${i}`}>
                        <TableCell>{(s.login_at || '').replace('T', ' ').slice(0, 19) || '-'}</TableCell>
                        <TableCell>{s.status || '-'}</TableCell>
                        <TableCell>{s.login_ip || '-'}</TableCell>
                        <TableCell>{s.login_city || '-'}</TableCell>
                        <TableCell>{(s.logout_at || '').replace('T', ' ').slice(0, 19) || '-'}</TableCell>
                        <TableCell>{typeof s.duration_seconds === 'number' ? s.duration_seconds : '-'}</TableCell>
                        <TableCell>{s.logout_reason || '-'}</TableCell>
                      </TableRow>
                    ))}
                    {sessions.length === 0 && <TableRow><TableCell colSpan={7} align="center">暂无数据</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </TableContainer>
              <TablePagination
                component="div"
                count={sessionTotal}
                page={sessionPage}
                rowsPerPage={sessionPageSize}
                onPageChange={(_, p) => setSessionPage(p)}
                onRowsPerPageChange={(e) => { setSessionPageSize(parseInt(e.target.value, 10)); setSessionPage(0); }}
                rowsPerPageOptions={[10, 20, 50]}
              />
            </>
          )}
        </Box>
      </Drawer>
    </Box>
  );
};

export default UserPermissionsPage;
