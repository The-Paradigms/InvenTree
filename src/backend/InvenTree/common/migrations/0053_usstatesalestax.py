from decimal import Decimal
import django.core.validators
from django.db import migrations, models


US_STATES_SALES_TAX_DATA = [
    ('AL', 'Alabama', '4.000'),
    ('AK', 'Alaska', '0.000'),
    ('AZ', 'Arizona', '5.600'),
    ('AR', 'Arkansas', '6.500'),
    ('CA', 'California', '7.250'),
    ('CO', 'Colorado', '2.900'),
    ('CT', 'Connecticut', '6.350'),
    ('DE', 'Delaware', '0.000'),
    ('DC', 'District of Columbia', '6.000'),
    ('FL', 'Florida', '6.000'),
    ('GA', 'Georgia', '4.000'),
    ('HI', 'Hawaii', '4.000'),
    ('ID', 'Idaho', '6.000'),
    ('IL', 'Illinois', '6.250'),
    ('IN', 'Indiana', '7.000'),
    ('IA', 'Iowa', '6.000'),
    ('KS', 'Kansas', '6.500'),
    ('KY', 'Kentucky', '6.000'),
    ('LA', 'Louisiana', '4.450'),
    ('ME', 'Maine', '5.500'),
    ('MD', 'Maryland', '6.000'),
    ('MA', 'Massachusetts', '6.250'),
    ('MI', 'Michigan', '6.000'),
    ('MN', 'Minnesota', '6.875'),
    ('MS', 'Mississippi', '7.000'),
    ('MO', 'Missouri', '4.225'),
    ('MT', 'Montana', '0.000'),
    ('NE', 'Nebraska', '5.500'),
    ('NV', 'Nevada', '6.850'),
    ('NH', 'New Hampshire', '0.000'),
    ('NJ', 'New Jersey', '6.625'),
    ('NM', 'New Mexico', '5.125'),
    ('NY', 'New York', '4.000'),
    ('NC', 'North Carolina', '4.750'),
    ('ND', 'North Dakota', '5.000'),
    ('OH', 'Ohio', '5.750'),
    ('OK', 'Oklahoma', '4.500'),
    ('OR', 'Oregon', '0.000'),
    ('PA', 'Pennsylvania', '6.000'),
    ('RI', 'Rhode Island', '7.000'),
    ('SC', 'South Carolina', '6.000'),
    ('SD', 'South Dakota', '4.200'),
    ('TN', 'Tennessee', '7.000'),
    ('TX', 'Texas', '6.250'),
    ('UT', 'Utah', '4.850'),
    ('VT', 'Vermont', '6.000'),
    ('VA', 'Virginia', '5.300'),
    ('WA', 'Washington', '6.500'),
    ('WV', 'West Virginia', '6.000'),
    ('WI', 'Wisconsin', '5.000'),
    ('WY', 'Wyoming', '4.000'),
]


def seed_us_states_sales_tax(apps, schema_editor):
    """Idempotently seed U.S. states sales tax rates."""
    USStateSalesTax = apps.get_model('common', 'USStateSalesTax')
    for state_key, state, rate in US_STATES_SALES_TAX_DATA:
        USStateSalesTax.objects.update_or_create(
            state_key=state_key,
            defaults={
                'state': state,
                'sales_tax_rate': Decimal(rate),
            },
        )


def reverse_seed_us_states_sales_tax(apps, schema_editor):
    """Remove seeded U.S. states sales tax rates."""
    USStateSalesTax = apps.get_model('common', 'USStateSalesTax')
    state_keys = [item[0] for item in US_STATES_SALES_TAX_DATA]
    USStateSalesTax.objects.filter(state_key__in=state_keys).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('common', '0052_remove_notesimage_model_id_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='USStateSalesTax',
            fields=[
                (
                    'id',
                    models.AutoField(
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    'state_key',
                    models.CharField(
                        help_text='Two-letter US state code',
                        max_length=2,
                        unique=True,
                        validators=[
                            django.core.validators.MinLengthValidator(2)
                        ],
                        verbose_name='State Key',
                    ),
                ),
                (
                    'state',
                    models.CharField(
                        help_text='US state name',
                        max_length=50,
                        unique=True,
                        verbose_name='State',
                    ),
                ),
                (
                    'sales_tax_rate',
                    models.DecimalField(
                        decimal_places=3,
                        default=Decimal('0.000'),
                        help_text='State sales tax rate as a percentage',
                        max_digits=6,
                        validators=[
                            django.core.validators.MinValueValidator(0),
                            django.core.validators.MaxValueValidator(100),
                        ],
                        verbose_name='Sales Tax Rate',
                    ),
                ),
            ],
            options={
                'verbose_name': 'US State Sales Tax',
                'verbose_name_plural': 'US States Sales Tax',
                'db_table': 'us_states_sales_tax',
                'ordering': ['state'],
            },
        ),
        migrations.RunPython(
            seed_us_states_sales_tax,
            reverse_code=reverse_seed_us_states_sales_tax,
        ),
    ]
