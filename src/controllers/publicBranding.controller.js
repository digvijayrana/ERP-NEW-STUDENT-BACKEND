const asyncHandler = require('../middleware/asyncHandler');
const {
  isMultiTenant,
  findTenantBySlug,
  getSchoolTenantModel,
  connectControlPlane
} = require('../services/tenantConnection.manager');
const { extractSubdomain } = require('../middleware/tenantContext');
const { getCachedSchoolBranding } = require('../services/governanceConfig.service');

/**
 * Public branding — derived from Host header only (no tenant query param).
 * GET /api/public/branding  (also /api/erp/public/branding via aliases)
 */
exports.branding = asyncHandler(async (req, res) => {
  const host = (req.get('host') || '').split(':')[0].toLowerCase();
  const slug = extractSubdomain(req.get('host') || '') || req.tenantSlug;

  if (slug === 'admin' || host.startsWith('admin.')) {
    return res.json({
      slug: 'admin',
      name: process.env.PLATFORM_NAME || 'School ERP Admin',
      logoUrl: process.env.PLATFORM_LOGO_URL || '',
      website: `https://admin.${process.env.ROOT_DOMAIN || 'schoolerp.local'}`,
      host,
      isAdmin: true
    });
  }

  if (isMultiTenant() && slug) {
    if (!getSchoolTenantModel()) await connectControlPlane();
    const tenant = await findTenantBySlug(slug);
    if (!tenant) {
      return res.status(404).json({ message: `School "${slug}" not found`, host });
    }
    if (tenant.status === 'suspended') {
      return res.status(403).json({ message: 'School suspended', slug });
    }
    return res.json({
      slug: tenant.slug,
      name: tenant.name,
      logoUrl: tenant.logoUrl || '',
      website: tenant.website || `https://${tenant.slug}.${process.env.ROOT_DOMAIN || 'schoolerp.local'}`,
      status: tenant.status,
      host,
      isAdmin: false
    });
  }

  const brand = getCachedSchoolBranding();
  res.json({
    slug: slug || 'default',
    name: brand.name,
    logoUrl: '',
    website: brand.website,
    host,
    isAdmin: false
  });
});
