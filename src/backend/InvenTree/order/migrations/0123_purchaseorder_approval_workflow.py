# Generated for Purchase Order Managerial Approval Workflow

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('order', '0122_remove_purchaseorder_notes_remove_returnorder_notes_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='purchaseorder',
            name='approval_status',
            field=models.CharField(
                choices=[
                    ('pending', 'Pending Approval'),
                    ('approved', 'Approved'),
                    ('rejected', 'Rejected'),
                    ('exempt', 'Exempt'),
                ],
                db_index=True,
                default='pending',
                help_text='Current managerial approval status',
                max_length=32,
                verbose_name='Approval Status',
            ),
        ),
        migrations.AddField(
            model_name='purchaseorder',
            name='approved_by',
            field=models.ForeignKey(
                blank=True,
                help_text='User who authorized this purchase order',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='approved_purchase_orders',
                to=settings.AUTH_USER_MODEL,
                verbose_name='Approved By',
            ),
        ),
        migrations.AddField(
            model_name='purchaseorder',
            name='approval_date',
            field=models.DateTimeField(
                blank=True,
                help_text='Date and time this order was approved',
                null=True,
                verbose_name='Approval Date',
            ),
        ),
        migrations.AddField(
            model_name='purchaseorder',
            name='approval_notes',
            field=models.TextField(
                blank=True,
                help_text='Notes or comments provided during approval or rejection',
                verbose_name='Approval Notes',
            ),
        ),
    ]